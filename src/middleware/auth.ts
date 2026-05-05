import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import type { MiddlewareHandler } from "hono"
import { getSupabase } from "../lib/supabase.js"

export type AuthUser = {
  id: string
  email: string | null
}

export type AuthEnv = {
  Variables: {
    user: AuthUser
    accessToken: string
  }
}

export const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const raw = (c.req.header("authorization") ?? "").trimStart()

  if (raw === "") {
    return c.json(
      { error: "Unauthorized", message: "Missing authorization header" },
      401,
    )
  }

  const bearerHead = raw.slice(0, 7).toLowerCase()
  if (bearerHead !== "bearer ") {
    return c.json(
      { error: "Unauthorized", message: "Invalid authorization header" },
      401,
    )
  }

  const token = raw.slice(7).trim()
  if (token === "") {
    return c.json(
      { error: "Unauthorized", message: "Invalid authorization header" },
      401,
    )
  }

  const supabase = getSupabase()

  let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>
  try {
    userResult = await supabase.auth.getUser(token)
  } catch (e) {
    if (isAuthRetryableFetchError(e)) {
      console.error("[auth] supabase fetch failure:", e.message)
      return c.json(
        {
          error: "Service Unavailable",
          message: "Auth service temporarily unavailable",
        },
        503,
      )
    }
    console.error(
      "[auth] supabase.getUser unexpected error:",
      e instanceof Error ? e.message : String(e),
    )
    return c.json(
      { error: "Internal Server Error", message: "Auth check failed" },
      500,
    )
  }

  const { data, error } = userResult
  if (error !== null) {
    if (isAuthRetryableFetchError(error)) {
      console.error("[auth] supabase fetch failure:", error.message)
      return c.json(
        {
          error: "Service Unavailable",
          message: "Auth service temporarily unavailable",
        },
        503,
      )
    }
    return c.json(
      { error: "Unauthorized", message: "Invalid or expired token" },
      401,
    )
  }
  if (data.user === null) {
    return c.json(
      { error: "Unauthorized", message: "Invalid or expired token" },
      401,
    )
  }

  const user = data.user
  c.set("user", {
    id: user.id,
    email: user.email ?? null,
  })
  c.set("accessToken", token)
  await next()
}
