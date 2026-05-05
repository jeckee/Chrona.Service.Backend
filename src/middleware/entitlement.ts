import type { Context, MiddlewareHandler } from "hono"
import { resolveEntitlement } from "../services/entitlementService.js"
import type { AuthEnv } from "./auth.js"

function jsonSubscriptionRequired(c: Context<AuthEnv>) {
  return c.json(
    {
      error: {
        code: "SUBSCRIPTION_REQUIRED",
        message: "Subscription required to use Chrona",
      },
    },
    402,
  )
}

export const requireEntitlementMiddleware: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  const user = c.get("user")
  const accessToken = c.get("accessToken")

  try {
    const entitlement = await resolveEntitlement({
      userId: user.id,
      accessToken,
      createIfMissing: false,
    })
    if (entitlement.status !== "trial" && entitlement.status !== "active") {
      return jsonSubscriptionRequired(c)
    }
  } catch (e) {
    // Fail-closed: any entitlement check failure should reject AI access,
    // never allow a possibly-unpaid user through on a transient DB error.
    console.error(
      "[entitlement] check failed (fail-closed):",
      e instanceof Error ? e.message : String(e),
    )
    return jsonSubscriptionRequired(c)
  }

  await next()
}
