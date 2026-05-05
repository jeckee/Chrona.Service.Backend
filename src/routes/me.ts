import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"
import { ensureUserProfile } from "../services/userService.js"

export const meRoute = new Hono<AuthEnv>()

meRoute.use(authMiddleware)

meRoute.get("/me", async (c) => {
  const user = c.get("user")
  const accessToken = c.get("accessToken")
  try {
    await ensureUserProfile({
      userId: user.id,
      email: user.email,
      accessToken,
    })
  } catch (e) {
    console.error(
      "[me] ensureUserProfile failed:",
      e instanceof Error ? e.message : String(e),
    )
  }
  return c.json({
    user: {
      id: user.id,
      email: user.email,
    },
  })
})
