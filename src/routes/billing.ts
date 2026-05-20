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

/** Bundlers may duplicate class identity across chunks; fall back to `error.name`. */
function isAppleTransactionRejected(e: unknown): boolean {
  return (
    e instanceof AppleTransactionVerificationError ||
    (e instanceof Error && e.name === "AppleTransactionVerificationError")
  )
}

function appleRejectDetails(e: Error): Record<string, unknown> | undefined {
  const d = (e as { details?: unknown }).details
  if (d !== undefined && typeof d === "object" && d !== null && !Array.isArray(d)) {
    return d as Record<string, unknown>
  }
  return undefined
}

export const billingRoute = new Hono<AuthEnv>()

billingRoute.use("*", async (c, next) => {
  // Mounted at app root; exclude Apple server-to-server webhooks from auth.
  const path = c.req.path
  if (path.startsWith("/apple/") || path.startsWith("/api/v1/apple/")) {
    await next()
    return
  }
  return authMiddleware(c, next)
})

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
    console.info(
      "[subscriptions/verify] verified transaction:",
      JSON.stringify({
        userId: user.id,
        transactionId: tx.transactionId,
        originalTransactionId: tx.originalTransactionId,
        productId: tx.productId,
        environment: tx.environment,
        purchaseDate: tx.purchaseDate,
        expiresDate: tx.expiresDate,
        revocationDate: tx.revocationDate,
        status: tx.status,
        trialEndsAt: tx.trialEndsAt,
      }),
    )
  } catch (e) {
    const summary =
      e instanceof Error
        ? {
            name: e.name,
            message: e.message,
            stack: (e.stack ?? "").slice(0, 400),
          }
        : { name: typeof e, message: String(e), stack: "" }
    console.error(
      "[subscriptions/verify] verify threw:",
      JSON.stringify(summary),
    )

    if (isAppleTransactionRejected(e) && e instanceof Error) {
      console.warn("[subscriptions/verify] reject:", e.message)
      const details = appleRejectDetails(e)
      if (details !== undefined) {
        console.error(
          "[subscriptions/verify] reject details:",
          JSON.stringify(details),
        )
      }
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
      forceExpired: tx.revocationDate !== null,
    })
    console.info(
      "[subscriptions/verify] response entitlement:",
      JSON.stringify({
        userId: user.id,
        entitlement,
      }),
    )
    return c.json({ entitlement }, 200)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[subscriptions/verify] persistence failed:", message)
    return jsonInternalError(c, "Failed to persist entitlement.")
  }
})
