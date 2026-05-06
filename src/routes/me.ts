import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"
import {
  NONE_ENTITLEMENT,
  resolveEntitlement,
  type EntitlementView,
} from "../services/entitlementService.js"
import { ensureUserProfile } from "../services/userService.js"

export const meRoute = new Hono<AuthEnv>()

meRoute.use("/me", authMiddleware)

meRoute.get("/me", async (c) => {
  const user = c.get("user")
  const accessToken = c.get("accessToken")

  let profileOk = true
  try {
    await ensureUserProfile({
      userId: user.id,
      email: user.email,
      accessToken,
    })
  } catch (e) {
    profileOk = false
    console.error(
      "[me] ensureUserProfile failed:",
      e instanceof Error ? e.message : String(e),
    )
  }

  let entitlement: EntitlementView
  try {
    entitlement = await resolveEntitlement({
      userId: user.id,
      accessToken,
      createIfMissing: profileOk,
    })
  } catch (e) {
    console.error(
      "[me] resolveEntitlement failed:",
      e instanceof Error ? e.message : String(e),
    )
    entitlement = NONE_ENTITLEMENT
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
    },
    entitlement,
  })
})
