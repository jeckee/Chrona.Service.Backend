import type { Context } from "hono"
import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"

type VerifyAppleRequest = {
  productId?: unknown
  transactionId?: unknown
  signedTransactionInfo?: unknown
  appAccountToken?: unknown
}

type RestoreAppleRequest = {
  transactions?: unknown
}

function jsonBadRequest(c: Context, message: string) {
  return c.json({ error: "Bad Request", message }, 400)
}

function jsonNotImplemented(c: Context, message: string) {
  return c.json(
    {
      error: {
        code: "NOT_IMPLEMENTED",
        message,
      },
    },
    501,
  )
}

function isString(v: unknown): v is string {
  return typeof v === "string"
}

function isOptionalNonEmptyString(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && v.trim() !== "")
}

function validateVerifyBody(
  body: unknown,
): VerifyAppleRequest | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "Body must be a JSON object." }
  }
  const o = body as VerifyAppleRequest

  if (!isOptionalNonEmptyString(o.productId)) {
    return { error: "productId must be a non-empty string when provided." }
  }
  if (!isOptionalNonEmptyString(o.transactionId)) {
    return { error: "transactionId must be a non-empty string when provided." }
  }
  if (!isOptionalNonEmptyString(o.signedTransactionInfo)) {
    return {
      error: "signedTransactionInfo must be a non-empty string when provided.",
    }
  }
  if (!isOptionalNonEmptyString(o.appAccountToken)) {
    return { error: "appAccountToken must be a non-empty string when provided." }
  }

  // Skeleton阶段至少要求一种transaction信息，避免空调用。
  const hasTxInfo =
    isString(o.transactionId) || isString(o.signedTransactionInfo)
  if (!hasTxInfo) {
    return {
      error:
        "Either transactionId or signedTransactionInfo is required for verify.",
    }
  }
  return o
}

function validateRestoreBody(
  body: unknown,
): RestoreAppleRequest | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "Body must be a JSON object." }
  }
  const o = body as RestoreAppleRequest
  if (o.transactions !== undefined && !Array.isArray(o.transactions)) {
    return { error: "transactions must be an array when provided." }
  }
  return o
}

export const billingRoute = new Hono<AuthEnv>()

billingRoute.use("*", authMiddleware)

billingRoute.post("/billing/apple/verify", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonBadRequest(c, "Invalid JSON body.")
  }

  const parsed = validateVerifyBody(body)
  if ("error" in parsed) {
    return jsonBadRequest(c, parsed.error)
  }

  return jsonNotImplemented(
    c,
    "Apple subscription verify is not implemented yet. Keep calling /api/v1/me to refresh entitlement state.",
  )
})

billingRoute.post("/billing/apple/restore", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonBadRequest(c, "Invalid JSON body.")
  }

  const parsed = validateRestoreBody(body)
  if ("error" in parsed) {
    return jsonBadRequest(c, parsed.error)
  }

  return jsonNotImplemented(
    c,
    "Apple restore is not implemented yet. Keep calling /api/v1/me to refresh entitlement state.",
  )
})
