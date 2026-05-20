import { readFileSync } from "node:fs"
import path from "node:path"
import {
  AppStoreServerAPIClient,
  APIException,
  Environment,
  OfferDiscountType,
  Status,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library"
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library"

export type AppleTransactionStatus = "trial" | "active" | "expired"

export type VerifiedAppleTransaction = {
  transactionId: string
  originalTransactionId: string
  productId: string
  bundleId: string
  environment: string
  purchaseDate: string | null
  expiresDate: string | null
  offerType: number | null
  offerIdentifier: string | null
  offerDiscountType: string | null
  revocationDate: string | null
  appAccountToken: string | null
  status: AppleTransactionStatus
  trialEndsAt: string | null
}

/**
 * Marker error: route maps this (and only this) to `INVALID_TRANSACTION` 400.
 * Any other thrown error is treated as a server-side fault (5xx).
 */
export class AppleTransactionVerificationError extends Error {
  readonly details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "AppleTransactionVerificationError"
    this.details = details
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function parseCsvEnv(name: string): ReadonlySet<string> {
  const raw = requireEnv(name)
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "")
  if (values.length === 0) {
    throw new Error(`${name} has no valid values`)
  }
  return new Set(values)
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return defaultValue
  return raw.trim().toLowerCase() === "true"
}

function toIsoFromMs(ms: number | undefined | null): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

let cachedRoots: Buffer[] | null = null
function loadAppleRoots(): Buffer[] {
  if (cachedRoots !== null) return cachedRoots
  const dir = process.env.APPLE_ROOT_CERTS_DIR ?? "certs"
  const base = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
  cachedRoots = [
    readFileSync(path.join(base, "AppleRootCA-G3.cer")),
    readFileSync(path.join(base, "AppleIncRootCertificate.cer")),
  ]
  return cachedRoots
}

const ENV_BY_NAME: Record<string, Environment> = {
  Production: Environment.PRODUCTION,
  Sandbox: Environment.SANDBOX,
  Xcode: Environment.XCODE,
  LocalTesting: Environment.LOCAL_TESTING,
}

const verifierCache = new Map<Environment, SignedDataVerifier>()
const apiClientCache = new Map<Environment, AppStoreServerAPIClient>()

function getVerifier(env: Environment): SignedDataVerifier {
  const cached = verifierCache.get(env)
  if (cached !== undefined) return cached

  const bundleId = requireEnv("APPLE_BUNDLE_ID")
  const enableOnlineChecks = parseBoolEnv("APPLE_ENABLE_ONLINE_CHECKS", false)

  let appAppleId: number | undefined
  if (env === Environment.PRODUCTION) {
    const raw = requireEnv("APPLE_APP_APPLE_ID")
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("APPLE_APP_APPLE_ID must be a positive integer")
    }
    appAppleId = parsed
  }

  const verifier = new SignedDataVerifier(
    loadAppleRoots(),
    enableOnlineChecks,
    env,
    bundleId,
    appAppleId,
  )
  verifierCache.set(env, verifier)
  return verifier
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]
  if (value === undefined || value.trim() === "") return null
  return value.trim()
}

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n")
}

function getAppStoreApiClient(env: Environment): AppStoreServerAPIClient | null {
  if (env === Environment.XCODE) return null

  const cached = apiClientCache.get(env)
  if (cached !== undefined) return cached

  const signingKey =
    optionalEnv("APPLE_IN_APP_PURCHASE_PRIVATE_KEY") ??
    optionalEnv("APPLE_PRIVATE_KEY")
  const keyId =
    optionalEnv("APPLE_IN_APP_PURCHASE_KEY_ID") ??
    optionalEnv("APPLE_KEY_ID")
  const issuerId =
    optionalEnv("APPLE_IN_APP_PURCHASE_ISSUER_ID") ??
    optionalEnv("APPLE_ISSUER_ID")
  const bundleId = optionalEnv("APPLE_BUNDLE_ID")

  if (
    signingKey === null ||
    keyId === null ||
    issuerId === null ||
    bundleId === null
  ) {
    return null
  }

  const client = new AppStoreServerAPIClient(
    normalizePrivateKey(signingKey),
    keyId,
    issuerId,
    bundleId,
    env,
  )
  apiClientCache.set(env, client)
  return client
}

/**
 * Try the configured environments (Production first), falling back on env
 * mismatch. Any other VerificationException short-circuits as INVALID.
 */
async function verifyAcrossEnvironments(
  signedTransaction: string,
): Promise<JWSTransactionDecodedPayload> {
  const allowedNames = parseCsvEnv("APPLE_ALLOWED_ENVIRONMENTS")
  const allowedEnvs = [...allowedNames]
    .map((name) => ENV_BY_NAME[name])
    .filter((e): e is Environment => e !== undefined)
  if (allowedEnvs.length === 0) {
    throw new Error("APPLE_ALLOWED_ENVIRONMENTS contains no recognized values")
  }

  const ordered = [
    ...allowedEnvs.filter((e) => e === Environment.PRODUCTION),
    ...allowedEnvs.filter((e) => e !== Environment.PRODUCTION),
  ]

  let lastEnvMismatch: VerificationException | null = null
  for (const env of ordered) {
    try {
      return await getVerifier(env).verifyAndDecodeTransaction(signedTransaction)
    } catch (e) {
      if (
        e instanceof VerificationException &&
        e.status === VerificationStatus.INVALID_ENVIRONMENT
      ) {
        lastEnvMismatch = e
        continue
      }
      throw e
    }
  }
  throw (
    lastEnvMismatch ??
    new VerificationException(VerificationStatus.INVALID_ENVIRONMENT)
  )
}

function resolveStatus(
  payload: JWSTransactionDecodedPayload,
  now: Date,
): { status: AppleTransactionStatus; trialEndsAt: string | null } {
  if (typeof payload.revocationDate === "number") {
    return { status: "expired", trialEndsAt: null }
  }
  const expiresMs = typeof payload.expiresDate === "number" ? payload.expiresDate : null
  if (expiresMs === null || expiresMs <= now.getTime()) {
    return { status: "expired", trialEndsAt: null }
  }
  if (payload.offerDiscountType === OfferDiscountType.FREE_TRIAL) {
    return { status: "trial", trialEndsAt: new Date(expiresMs).toISOString() }
  }
  return { status: "active", trialEndsAt: null }
}

function resolveStatusFromAppleStatus(
  payload: JWSTransactionDecodedPayload,
  appleStatus: Status | number | undefined,
  now: Date,
): { status: AppleTransactionStatus; trialEndsAt: string | null } {
  if (
    appleStatus === Status.ACTIVE ||
    appleStatus === Status.BILLING_GRACE_PERIOD
  ) {
    if (payload.offerDiscountType === OfferDiscountType.FREE_TRIAL) {
      return {
        status: "trial",
        trialEndsAt: toIsoFromMs(payload.expiresDate),
      }
    }
    return { status: "active", trialEndsAt: null }
  }
  return resolveStatus(payload, now)
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== ""
}

function toVerifiedTransaction(params: {
  payload: JWSTransactionDecodedPayload
  expectedAppAccountToken: string
  allowedProductIds: ReadonlySet<string>
  statusOverride?: Status | number
}): VerifiedAppleTransaction {
  const { payload } = params
  if (
    !nonEmptyString(payload.transactionId) ||
    !nonEmptyString(payload.originalTransactionId) ||
    !nonEmptyString(payload.productId) ||
    !nonEmptyString(payload.bundleId) ||
    !nonEmptyString(payload.environment)
  ) {
    throw new AppleTransactionVerificationError(
      "Required fields missing from transaction payload",
    )
  }

  if (!params.allowedProductIds.has(payload.productId)) {
    throw new AppleTransactionVerificationError(
      `productId ${payload.productId} is not in allowlist`,
    )
  }

  const expectedToken = params.expectedAppAccountToken.trim().toLowerCase()
  const actualToken = nonEmptyString(payload.appAccountToken)
    ? payload.appAccountToken.trim().toLowerCase()
    : null
  if (actualToken === null || actualToken !== expectedToken) {
    throw new AppleTransactionVerificationError(
      "appAccountToken does not match authenticated user",
      {
        transactionId: payload.transactionId,
        originalTransactionId: payload.originalTransactionId,
        environment: payload.environment,
        productId: payload.productId,
        expectedAppAccountToken: expectedToken,
        actualAppAccountToken: actualToken ?? "(missing or empty)",
      },
    )
  }

  const { status, trialEndsAt } = resolveStatusFromAppleStatus(
    payload,
    params.statusOverride,
    new Date(),
  )

  return {
    transactionId: payload.transactionId,
    originalTransactionId: payload.originalTransactionId,
    productId: payload.productId,
    bundleId: payload.bundleId,
    environment: payload.environment,
    purchaseDate: toIsoFromMs(payload.purchaseDate),
    expiresDate: toIsoFromMs(payload.expiresDate),
    offerType: typeof payload.offerType === "number" ? payload.offerType : null,
    offerIdentifier: nonEmptyString(payload.offerIdentifier)
      ? payload.offerIdentifier
      : null,
    offerDiscountType: nonEmptyString(payload.offerDiscountType)
      ? payload.offerDiscountType
      : null,
    revocationDate: toIsoFromMs(payload.revocationDate),
    appAccountToken: payload.appAccountToken ?? null,
    status,
    trialEndsAt,
  }
}

function parseEnvironment(raw: string): Environment | null {
  return ENV_BY_NAME[raw] ?? null
}

function expiresMs(tx: VerifiedAppleTransaction): number {
  if (tx.expiresDate === null) return 0
  const parsed = Date.parse(tx.expiresDate)
  return Number.isNaN(parsed) ? 0 : parsed
}

function compareTransactions(
  a: VerifiedAppleTransaction,
  b: VerifiedAppleTransaction,
): number {
  const byExpiry = expiresMs(a) - expiresMs(b)
  if (byExpiry !== 0) return byExpiry
  return a.transactionId.localeCompare(b.transactionId)
}

async function resolveLatestSubscriptionTransaction(params: {
  initial: VerifiedAppleTransaction
  expectedAppAccountToken: string
  allowedProductIds: ReadonlySet<string>
}): Promise<VerifiedAppleTransaction> {
  const env = parseEnvironment(params.initial.environment)
  const client = env === null ? null : getAppStoreApiClient(env)
  if (client === null) return params.initial

  let response
  try {
    response = await client.getAllSubscriptionStatuses(
      params.initial.originalTransactionId,
    )
  } catch (e) {
    const detail =
      e instanceof APIException
        ? `http=${e.httpStatusCode} apiError=${e.apiError ?? "null"}`
        : e instanceof Error
          ? e.message
          : String(e)
    console.warn("[subscriptions/verify] Apple status lookup failed:", detail)
    return params.initial
  }

  const candidates: VerifiedAppleTransaction[] = [params.initial]
  for (const group of response.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (!nonEmptyString(item.signedTransactionInfo)) continue
      let payload: JWSTransactionDecodedPayload
      try {
        payload = await verifyAcrossEnvironments(item.signedTransactionInfo)
      } catch (e) {
        console.warn(
          "[subscriptions/verify] latest transaction JWS rejected:",
          e instanceof Error ? e.message : String(e),
        )
        continue
      }
      try {
        const tx = toVerifiedTransaction({
          payload,
          expectedAppAccountToken: params.expectedAppAccountToken,
          allowedProductIds: params.allowedProductIds,
          statusOverride: item.status,
        })
        if (tx.originalTransactionId === params.initial.originalTransactionId) {
          candidates.push(tx)
        }
      } catch (e) {
        console.warn(
          "[subscriptions/verify] latest transaction ignored:",
          e instanceof Error ? e.message : String(e),
        )
      }
    }
  }

  return candidates.reduce((best, tx) =>
    compareTransactions(tx, best) > 0 ? tx : best,
  )
}

/**
 * Verifies the JWS chain against Apple Root CA via the official library, then
 * applies Chrona-side invariants (productId allowlist, appAccountToken binding).
 *
 * Throws `AppleTransactionVerificationError` on every client-attributable
 * failure; route layer maps this to `INVALID_TRANSACTION` 400. Any other thrown
 * error indicates a server-side fault and should bubble up as 5xx.
 */
export async function verifyAppleSignedTransaction(params: {
  signedTransaction: string
  expectedAppAccountToken: string
}): Promise<VerifiedAppleTransaction> {
  const allowedProductIds = parseCsvEnv("APPLE_ALLOWED_PRODUCT_IDS")

  let payload: JWSTransactionDecodedPayload
  try {
    payload = await verifyAcrossEnvironments(params.signedTransaction)
  } catch (e) {
    if (e instanceof VerificationException) {
      throw new AppleTransactionVerificationError(
        `JWS verification failed (status=${e.status})`,
      )
    }
    throw e
  }

  const initial = toVerifiedTransaction({
    payload,
    expectedAppAccountToken: params.expectedAppAccountToken,
    allowedProductIds,
  })

  return resolveLatestSubscriptionTransaction({
    initial,
    expectedAppAccountToken: params.expectedAppAccountToken,
    allowedProductIds,
  })
}
