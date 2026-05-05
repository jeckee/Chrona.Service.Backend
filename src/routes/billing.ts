import type { Context } from "hono"
import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"
import {
  AppleTransactionVerificationError,
  verifyAppleSignedTransaction,
  type VerifiedAppleTransaction,
} from "../services/appleTransactionService.js"
import { upsertVerifiedEntitlement } from "../services/entitlementService.js"
import { ensureUserProfile } from "../services/userService.js"

type VerifyAppleRequest = {
  signedTransaction: string
}

function jsonBadRequest(c: Context, message: string) {
  return c.json({ error: "Bad Request", message }, 400)
}

function jsonInvalidTransaction(c: Context) {
  return c.json(
    {
      error: {
        code: "INVALID_TRANSACTION",
        message: "Invalid Apple transaction",
      },
    },
    400,
  )
}

function jsonInternalError(c: Context, message: string) {
  return c.json({ error: "Internal Server Error", message }, 500)
}

function validateVerifyBody(
  body: unknown,
): VerifyAppleRequest | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "Body must be a JSON object." }
  }
  const o = body as { signedTransaction?: unknown }
  if (
    typeof o.signedTransaction !== "string" ||
    o.signedTransaction.trim() === ""
  ) {
    return { error: "signedTransaction must be a non-empty string." }
  }
  return { signedTransaction: o.signedTransaction }
}

export const billingRoute = new Hono<AuthEnv>()

billingRoute.use("*", authMiddleware)

billingRoute.post("/subscriptions/verify", async (c) => {
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

  const user = c.get("user")
  const accessToken = c.get("accessToken")

  let tx: VerifiedAppleTransaction
  try {
    tx = await verifyAppleSignedTransaction({
      signedTransaction: parsed.signedTransaction,
      expectedAppAccountToken: user.id,
    })
  } catch (e) {
    if (e instanceof AppleTransactionVerificationError) {
      console.warn("[subscriptions/verify] reject:", e.message)
      return jsonInvalidTransaction(c)
    }
    const message = e instanceof Error ? e.message : String(e)
    console.error("[subscriptions/verify] verifier error:", message)
    return jsonInternalError(c, "Subscription verifier unavailable.")
  }

  try {
    await ensureUserProfile({
      userId: user.id,
      email: user.email,
      accessToken,
    })
    const entitlement = await upsertVerifiedEntitlement({
      userId: user.id,
      status: tx.status,
      productId: tx.productId,
      originalTransactionId: tx.originalTransactionId,
      latestTransactionId: tx.transactionId,
      environment: tx.environment,
      expiresAt: tx.expiresDate,
      trialEndsAt: tx.trialEndsAt,
    })
    return c.json({ entitlement }, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[subscriptions/verify] persistence failed:", message)
    return jsonInternalError(c, "Failed to persist entitlement.")
  }
})
