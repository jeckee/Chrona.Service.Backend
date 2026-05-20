import {
  createSupabaseUserClient,
  getSupabaseServiceRole,
} from "../lib/supabase.js"

export type EntitlementStatus = "none" | "trial" | "active" | "expired"

export type EntitlementView = {
  status: EntitlementStatus
  productId: string | null
  expiresAt: string | null
  trialEndsAt: string | null
}

type EntitlementRow = {
  user_id: string
  status: string
  product_id: string | null
  original_transaction_id?: string | null
  latest_transaction_id?: string | null
  environment?: string | null
  expires_at: string | null
  trial_ends_at: string | null
}

const ENTITLEMENT_COLUMNS =
  "user_id, status, product_id, expires_at, trial_ends_at"

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "none",
  "trial",
  "active",
  "expired",
])

const NONE_VIEW: EntitlementView = {
  status: "none",
  productId: null,
  expiresAt: null,
  trialEndsAt: null,
}

function normalizeStatus(raw: string): EntitlementStatus {
  if (VALID_STATUSES.has(raw)) {
    return raw as EntitlementStatus
  }
  return "none"
}

function isExpired(expiresAt: string | null, now = new Date()): boolean {
  if (expiresAt === null) return false
  const parsed = Date.parse(expiresAt)
  if (Number.isNaN(parsed)) return false
  return parsed <= now.getTime()
}

function shouldTransitionToExpired(row: EntitlementRow): boolean {
  const status = normalizeStatus(row.status)
  if (status === "trial") {
    return isExpired(row.trial_ends_at)
  }
  if (status === "active") {
    return isExpired(row.expires_at)
  }
  return false
}

function toEntitlementView(row: EntitlementRow | null): EntitlementView {
  if (row === null) return NONE_VIEW
  return {
    status: normalizeStatus(row.status),
    productId: row.product_id,
    expiresAt: row.expires_at,
    trialEndsAt: row.trial_ends_at,
  }
}

/** Reads use user JWT so RLS `select own` applies (defense in depth). */
async function readEntitlementRow(params: {
  userId: string
  accessToken: string
}): Promise<EntitlementRow | null> {
  const client = createSupabaseUserClient(params.accessToken)
  const { data, error } = await client
    .from("user_entitlements")
    .select(ENTITLEMENT_COLUMNS)
    .eq("user_id", params.userId)
    .maybeSingle<EntitlementRow>()

  if (error !== null) {
    throw new Error(`read entitlement failed: ${error.message}`)
  }
  return data
}

/**
 * Idempotent: upsert with `ignoreDuplicates` avoids races between concurrent
 * `/me` calls. Re-reads the row when the insert was skipped.
 */
async function ensureNoneEntitlementRow(params: {
  userId: string
  accessToken: string
}): Promise<EntitlementRow> {
  const adminClient = getSupabaseServiceRole()
  const { data, error } = await adminClient
    .from("user_entitlements")
    .upsert(
      { user_id: params.userId, status: "none" },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select(ENTITLEMENT_COLUMNS)
    .maybeSingle<EntitlementRow>()

  if (error !== null) {
    throw new Error(`ensure none entitlement failed: ${error.message}`)
  }
  if (data !== null) return data

  const existing = await readEntitlementRow(params)
  if (existing === null) {
    throw new Error("ensure none entitlement: row missing after upsert")
  }
  return existing
}

async function markExpired(params: {
  userId: string
}): Promise<EntitlementRow> {
  const adminClient = getSupabaseServiceRole()
  const { data, error } = await adminClient
    .from("user_entitlements")
    .update({ status: "expired" })
    .eq("user_id", params.userId)
    .select(ENTITLEMENT_COLUMNS)
    .single<EntitlementRow>()

  if (error !== null) {
    throw new Error(`mark entitlement expired failed: ${error.message}`)
  }
  return data
}

export async function resolveEntitlement(params: {
  userId: string
  accessToken: string
  createIfMissing?: boolean
}): Promise<EntitlementView> {
  const createIfMissing = params.createIfMissing ?? false
  let row = await readEntitlementRow(params)

  if (row === null && createIfMissing) {
    row = await ensureNoneEntitlementRow(params)
  }

  if (row === null) return NONE_VIEW

  if (shouldTransitionToExpired(row)) {
    const expired = await markExpired({ userId: params.userId })
    return toEntitlementView(expired)
  }

  return toEntitlementView(row)
}

/** Used as a fail-closed default when entitlement read fails (DB outage etc). */
export const NONE_ENTITLEMENT: EntitlementView = NONE_VIEW

export type UpsertEntitlementInput = {
  userId: string
  status: Exclude<EntitlementStatus, "none">
  productId: string
  originalTransactionId: string
  latestTransactionId: string
  environment?: string
  expiresAt: string | null
  trialEndsAt: string | null
  forceExpired?: boolean
}

function isMissingEnvironmentColumnError(message: string): boolean {
  return (
    message.includes("Could not find the 'environment' column") &&
    message.includes("user_entitlements")
  )
}

function timestampMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function entitlementEndMs(input: {
  status: string
  expires_at?: string | null
  trial_ends_at?: string | null
  expiresAt?: string | null
  trialEndsAt?: string | null
}): number | null {
  const status = normalizeStatus(input.status)
  if (status === "trial") {
    return timestampMs(input.trial_ends_at ?? input.trialEndsAt ?? null)
  }
  return timestampMs(input.expires_at ?? input.expiresAt ?? null)
}

function shouldPreserveExistingEntitlement(params: {
  existing: EntitlementRow | null
  incomingStatus: "trial" | "active" | "expired"
  incomingExpiresAt?: string | null
  incomingTrialEndsAt?: string | null
  forceExpired?: boolean
}): boolean {
  if (params.existing === null) return false
  if (params.forceExpired === true) return false

  const existingStatus = normalizeStatus(params.existing.status)
  if (existingStatus !== "trial" && existingStatus !== "active") return false
  if (shouldTransitionToExpired(params.existing)) return false

  const existingEnd = entitlementEndMs(params.existing)
  const incomingEnd = entitlementEndMs({
    status: params.incomingStatus,
    expiresAt: params.incomingExpiresAt ?? null,
    trialEndsAt: params.incomingTrialEndsAt ?? null,
  })
  if (existingEnd === null || incomingEnd === null) return false

  return incomingEnd < existingEnd
}

export async function upsertVerifiedEntitlement(
  input: UpsertEntitlementInput,
): Promise<EntitlementView> {
  const adminClient = getSupabaseServiceRole()
  const { data: existingRow, error: existingError } = await adminClient
    .from("user_entitlements")
    .select(
      "user_id, status, product_id, original_transaction_id, latest_transaction_id, environment, expires_at, trial_ends_at",
    )
    .eq("user_id", input.userId)
    .maybeSingle<EntitlementRow>()

  if (existingError !== null) {
    throw new Error(`read existing entitlement failed: ${existingError.message}`)
  }
  console.info(
    "[entitlement/upsert] before write:",
    JSON.stringify({
      userId: input.userId,
      incoming: {
        status: input.status,
        productId: input.productId,
        originalTransactionId: input.originalTransactionId,
        latestTransactionId: input.latestTransactionId,
        environment: input.environment ?? null,
        expiresAt: input.expiresAt,
        trialEndsAt: input.trialEndsAt,
      },
      existing: existingRow ?? null,
    }),
  )

  if (
    shouldPreserveExistingEntitlement({
      existing: existingRow,
      incomingStatus: input.status,
      incomingExpiresAt: input.expiresAt,
      incomingTrialEndsAt: input.trialEndsAt,
      forceExpired: input.forceExpired,
    })
  ) {
    console.warn(
      "[entitlement/upsert] ignored stale entitlement update:",
      JSON.stringify({
        userId: input.userId,
        incoming: {
          status: input.status,
          latestTransactionId: input.latestTransactionId,
          expiresAt: input.expiresAt,
        },
        existing: existingRow,
      }),
    )
    return toEntitlementView(existingRow)
  }

  const basePayload = {
    user_id: input.userId,
    status: input.status,
    product_id: input.productId,
    original_transaction_id: input.originalTransactionId,
    latest_transaction_id: input.latestTransactionId,
    expires_at: input.expiresAt,
    trial_ends_at: input.trialEndsAt,
  }
  const withEnvironmentPayload = {
    ...basePayload,
    environment: input.environment ?? null,
  }

  let { data, error } = await adminClient
    .from("user_entitlements")
    .upsert(withEnvironmentPayload, { onConflict: "user_id" })
    .select(ENTITLEMENT_COLUMNS)
    .single<EntitlementRow>()

  if (
    error !== null &&
    isMissingEnvironmentColumnError(error.message)
  ) {
    ;({ data, error } = await adminClient
      .from("user_entitlements")
      .upsert(basePayload, { onConflict: "user_id" })
      .select(ENTITLEMENT_COLUMNS)
      .single<EntitlementRow>())
  }

  if (error !== null) {
    throw new Error(`upsert verified entitlement failed: ${error.message}`)
  }
  console.info(
    "[entitlement/upsert] after write:",
    JSON.stringify({
      userId: input.userId,
      persisted: data,
    }),
  )
  return toEntitlementView(data)
}

/**
 * Server-authoritative entitlement upsert driven by Apple Server Notifications.
 * `updated_at` is maintained by the `user_entitlements_set_updated_at` trigger.
 * Falls back to a payload without the `environment` column on older databases
 * to mirror `upsertVerifiedEntitlement` and avoid PGRST204 churn.
 */
export async function upsertUserEntitlementFromApple(params: {
  userId: string
  status: "trial" | "active" | "expired"
  productId?: string | null
  originalTransactionId?: string | null
  latestTransactionId?: string | null
  environment?: string | null
  expiresAt?: string | null
  trialEndsAt?: string | null
  forceExpired?: boolean
}): Promise<void> {
  const adminClient = getSupabaseServiceRole()
  const { data: existingRow, error: existingError } = await adminClient
    .from("user_entitlements")
    .select(
      "user_id, status, product_id, original_transaction_id, latest_transaction_id, environment, expires_at, trial_ends_at",
    )
    .eq("user_id", params.userId)
    .maybeSingle<EntitlementRow>()

  if (existingError !== null) {
    throw new Error(`read existing entitlement failed: ${existingError.message}`)
  }

  if (
    shouldPreserveExistingEntitlement({
      existing: existingRow,
      incomingStatus: params.status,
      incomingExpiresAt: params.expiresAt ?? null,
      incomingTrialEndsAt: params.trialEndsAt ?? null,
      forceExpired: params.forceExpired,
    })
  ) {
    console.warn(
      "[entitlement/apple] ignored stale entitlement update:",
      JSON.stringify({
        userId: params.userId,
        incoming: {
          status: params.status,
          latestTransactionId: params.latestTransactionId ?? null,
          expiresAt: params.expiresAt ?? null,
        },
        existing: existingRow,
      }),
    )
    return
  }

  const basePayload = {
    user_id: params.userId,
    status: params.status,
    product_id: params.productId ?? null,
    original_transaction_id: params.originalTransactionId ?? null,
    latest_transaction_id: params.latestTransactionId ?? null,
    expires_at: params.expiresAt ?? null,
    trial_ends_at: params.trialEndsAt ?? null,
  }
  const withEnvironmentPayload = {
    ...basePayload,
    environment: params.environment ?? null,
  }

  let { error } = await adminClient
    .from("user_entitlements")
    .upsert(withEnvironmentPayload, { onConflict: "user_id" })

  if (error !== null && isMissingEnvironmentColumnError(error.message)) {
    ;({ error } = await adminClient
      .from("user_entitlements")
      .upsert(basePayload, { onConflict: "user_id" }))
  }

  if (error !== null) {
    throw new Error(`upsert entitlement from Apple failed: ${error.message}`)
  }
}

export async function updateUserEntitlementProductFromApple(params: {
  userId: string
  productId: string
  latestTransactionId?: string | null
  expiresAt?: string | null
}): Promise<void> {
  const adminClient = getSupabaseServiceRole()
  const updates: Record<string, string | null> = {
    product_id: params.productId,
  }
  if (params.latestTransactionId !== undefined) {
    updates.latest_transaction_id = params.latestTransactionId
  }
  if (params.expiresAt !== undefined) {
    updates.expires_at = params.expiresAt
  }

  const { error } = await adminClient
    .from("user_entitlements")
    .update(updates)
    .eq("user_id", params.userId)

  if (error !== null) {
    throw new Error(`update entitlement product from Apple failed: ${error.message}`)
  }
}
