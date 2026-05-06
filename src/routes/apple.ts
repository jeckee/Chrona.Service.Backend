import { Hono } from "hono"
import {
  InvalidAppleNotificationPayloadError,
  processAppleNotification,
} from "../services/appleNotificationService.js"

export const appleRoute = new Hono()

appleRoute.post("/apple/notifications", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Bad Request", message: "Missing signedPayload" }, 400)
  }

  const signedPayload =
    body !== null &&
    typeof body === "object" &&
    typeof (body as { signedPayload?: unknown }).signedPayload === "string"
      ? (body as { signedPayload: string }).signedPayload.trim()
      : ""

  if (signedPayload === "") {
    return c.json({ error: "Bad Request", message: "Missing signedPayload" }, 400)
  }

  try {
    const result = await processAppleNotification(signedPayload)
    return c.json({ ok: true, status: result.status }, 200)
  } catch (error) {
    if (error instanceof InvalidAppleNotificationPayloadError) {
      return c.json(
        { ok: false, error: "Invalid Apple notification payload" },
        400,
      )
    }

    console.error("[AppleNotification] process failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    // Return 200 to prevent Apple from retrying indefinitely while still
    // signalling failure in the response body for our own observability.
    return c.json({ ok: false, status: "failed" }, 200)
  }
})
