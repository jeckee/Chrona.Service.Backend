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
}

function isMissingEnvironmentColumnError(message: string): boolean {
  return (
    message.includes("Could not find the 'environment' column") &&
    message.includes("user_entitlements")
  )
}

export async function upsertVerifiedEntitlement(
  input: UpsertEntitlementInput,
): Promise<EntitlementView> {
  const adminClient = getSupabaseServiceRole()
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
  return toEntitlementView(data)
}
