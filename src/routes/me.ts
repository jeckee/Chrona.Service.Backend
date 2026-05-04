import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"

export const meRoute = new Hono<AuthEnv>()

meRoute.use(authMiddleware)

meRoute.get("/me", (c) => {
  const user = c.get("user")
  return c.json({
    user: {
      id: user.id,
      email: user.email,
    },
  })
})
