import type { MiddlewareHandler } from "hono"

export type MockUser = {
  id: string
  email: string
}

export type AuthEnv = {
  Variables: {
    user: MockUser
  }
}

export const mockAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set("user", {
    id: "mock-user-1",
    email: "mock@chrona.local",
  })
  await next()
}
