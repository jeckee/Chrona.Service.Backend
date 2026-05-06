import { readFileSync } from "node:fs"
import path from "node:path"
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === "") return defaultValue
  return raw.trim().toLowerCase() === "true"
}

function parseAppAppleId(raw: string | undefined, env: Environment): number | undefined {
  if (env !== Environment.PRODUCTION) {
    if (raw === undefined || raw.trim() === "") return undefined
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("APPLE_APP_APPLE_ID must be a positive integer string")
    }
    return parsed
  }
  if (raw === undefined || raw.trim() === "") {
    throw new Error("Missing required environment variable: APPLE_APP_APPLE_ID")
  }
  const parsed = Number(raw.trim())
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("APPLE_APP_APPLE_ID must be a positive integer string")
  }
  return parsed
}

/** Same names as `appleTransactionService` / App Store Server Library. */
const ENVIRONMENT_BY_ALLOWED_NAME: Record<string, Environment> = {
  Production: Environment.PRODUCTION,
  Sandbox: Environment.SANDBOX,
  Xcode: Environment.XCODE,
  LocalTesting: Environment.LOCAL_TESTING,
}

function parseAppleAllowedEnvironmentsCsv(raw: string): Environment[] {
  const names = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "")
  const out: Environment[] = []
  for (const name of names) {
    const env = ENVIRONMENT_BY_ALLOWED_NAME[name]
    if (env === undefined) {
      throw new Error(
        `Unrecognized APPLE_ALLOWED_ENVIRONMENTS entry: ${name}. ` +
          "Expected one of Production, Sandbox, Xcode, LocalTesting.",
      )
    }
    out.push(env)
  }
  if (out.length === 0) {
    throw new Error("APPLE_ALLOWED_ENVIRONMENTS has no valid values")
  }
  return out
}

function verifierTryOrder(environments: Environment[]): Environment[] {
  return [
    ...environments.filter((e) => e === Environment.PRODUCTION),
    ...environments.filter((e) => e !== Environment.PRODUCTION),
  ]
}

function buildAppleSignedDataVerifier(env: Environment): SignedDataVerifier {
  const bundleId = requireEnv("APPLE_BUNDLE_ID")
  const appAppleId = parseAppAppleId(process.env.APPLE_APP_APPLE_ID, env)
  const rootCertificates = loadRootCertificates()
  const enableOnlineChecks = parseBoolEnv("APPLE_ENABLE_ONLINE_CHECKS", false)
  return new SignedDataVerifier(
    rootCertificates,
    enableOnlineChecks,
    env,
    bundleId,
    appAppleId,
  )
}

const PEM_BLOCK_REGEX = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/

/**
 * Apple's official library (via pkijs) requires DER-encoded certificate bytes.
 * Decode either PEM blocks or `---CERT---`-separated base64 segments to DER.
 */
function decodeCertificateEnv(raw: string): Buffer[] {
  const normalized = raw.replace(/\\n/g, "\n")

  const pemBuffers: Buffer[] = []
  PEM_BLOCK_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PEM_BLOCK_REGEX.exec(normalized)) !== null) {
    const base64 = match[1].replace(/\s+/g, "")
    if (base64 === "") continue
    pemBuffers.push(Buffer.from(base64, "base64"))
  }
  if (pemBuffers.length > 0) return pemBuffers

  const parts = normalized
    .split("---CERT---")
    .map((part) => part.replace(/\s+/g, ""))
    .filter((part) => part !== "")
  const base64Buffers: Buffer[] = []
  for (const part of parts) {
    if (!BASE64_REGEX.test(part)) continue
    const buf = Buffer.from(part, "base64")
    if (buf.length > 0) base64Buffers.push(buf)
  }
  if (base64Buffers.length > 0) return base64Buffers

  throw new Error(
    "APPLE_ROOT_CERTIFICATES has no decodable certificate content " +
      "(expected PEM blocks or base64-encoded DER, optionally separated by ---CERT---)",
  )
}

/**
 * Bundled Apple root CA files shipped with the repo (`certs/*.cer`, DER).
 * Vercel includes this directory via `vercel.json.includeFiles`.
 */
function readCertificatesFromDisk(): Buffer[] {
  const dir = process.env.APPLE_ROOT_CERTS_DIR ?? "certs"
  const base = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
  return [
    readFileSync(path.join(base, "AppleRootCA-G3.cer")),
    readFileSync(path.join(base, "AppleIncRootCertificate.cer")),
  ]
}

/**
 * Source priority: env (PEM/base64) overrides the on-disk `certs/` files.
 * This lets ops swap the trust store without a redeploy when needed.
 */
function loadRootCertificates(): Buffer[] {
  const fromEnv = process.env.APPLE_ROOT_CERTIFICATES
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return decodeCertificateEnv(fromEnv)
  }
  return readCertificatesFromDisk()
}

let notificationVerifiersCache: SignedDataVerifier[] | null = null

/**
 * Verifiers for App Store Server Notifications. Uses the same required
 * `APPLE_ALLOWED_ENVIRONMENTS` CSV as client transaction verification: one
 * verifier per entry, Production first, then the rest.
 */
export function getAppleNotificationVerifiers(): SignedDataVerifier[] {
  if (notificationVerifiersCache !== null) return notificationVerifiersCache

  const allowedCsv = requireEnv("APPLE_ALLOWED_ENVIRONMENTS")
  const envs = verifierTryOrder(parseAppleAllowedEnvironmentsCsv(allowedCsv))
  notificationVerifiersCache = envs.map((e) => buildAppleSignedDataVerifier(e))
  return notificationVerifiersCache
}
