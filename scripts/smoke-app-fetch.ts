/**
 * Smoke test via Hono app.fetch() (no Vercel CLI).
 * Requires: SUPABASE_URL, SUPABASE_ANON_KEY (see src/lib/supabase.ts).
 *
 * Authenticated scenarios: set CHRONA_SMOKE_BEARER to a Supabase access_token.
 *
 * Run: npx tsx scripts/smoke-app-fetch.ts
 */
import { app } from "../src/app.js"

const smokeBearer = process.env.CHRONA_SMOKE_BEARER

async function req(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const init: RequestInit = { method }
  const headers: Record<string, string> = { ...extraHeaders }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  if (Object.keys(headers).length > 0) init.headers = headers
  return app.request(`http://test${path}`, init)
}

async function main() {
  const health = await req("GET", "/api/v1/health")
  console.log("GET /api/v1/health", health.status, await health.text())

  const meNoAuth = await req("GET", "/api/v1/me")
  console.log("GET /api/v1/me (no auth)", meNoAuth.status, await meNoAuth.text())

  const meBadToken = await req("GET", "/api/v1/me", undefined, {
    Authorization: "Bearer invalid",
  })
  console.log(
    "GET /api/v1/me (invalid token)",
    meBadToken.status,
    await meBadToken.text(),
  )

  if (smokeBearer) {
    const meOk = await req("GET", "/api/v1/me", undefined, {
      Authorization: `Bearer ${smokeBearer}`,
    })
    console.log("GET /api/v1/me (bearer)", meOk.status, await meOk.text())
  } else {
    console.log(
      "GET /api/v1/me (bearer): skip — set CHRONA_SMOKE_BEARER to test success",
    )
  }

  const badSchedule = await req("POST", "/api/v1/agent/schedule", {
    selectedDate: "",
    currentTime: "x",
    workingHours: [],
    scheduledTasks: [],
    unscheduledTasks: [],
  })
  console.log(
    "POST /api/v1/agent/schedule (no auth)",
    badSchedule.status,
    await badSchedule.text(),
  )

  if (!smokeBearer) {
    console.log(
      "POST /api/v1/agent/* (authenticated): skip — set CHRONA_SMOKE_BEARER",
    )
    return
  }

  const authHeaders = { Authorization: `Bearer ${smokeBearer}` }

  const badScheduleAuthed = await req(
    "POST",
    "/api/v1/agent/schedule",
    {
      selectedDate: "",
      currentTime: "x",
      workingHours: [],
      scheduledTasks: [],
      unscheduledTasks: [],
    },
    authHeaders,
  )
  console.log(
    "POST /api/v1/agent/schedule (invalid body, authed)",
    badScheduleAuthed.status,
    await badScheduleAuthed.text(),
  )

  const scheduleOk = await req(
    "POST",
    "/api/v1/agent/schedule",
    {
      selectedDate: "2026-05-04",
      currentTime: "2026-05-04T09:00:00",
      workingHours: [
        {
          start: "2026-05-04T09:00:00",
          end: "2026-05-04T17:00:00",
        },
      ],
      scheduledTasks: [],
      unscheduledTasks: [
        {
          taskId: "task-1",
          title: "Write product spec",
          estimatedMinutes: null,
          priority: null,
          userTimeHint: null,
          status: "todo",
          needs_analysis: true,
        },
      ],
    },
    authHeaders,
  )
  console.log(
    "POST /api/v1/agent/schedule (authed)",
    scheduleOk.status,
    await scheduleOk.text(),
  )

  const badSummary = await app.request("http://test/api/v1/agent/summary", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders,
    },
    body: "not json",
  })
  console.log(
    "POST /api/v1/agent/summary (invalid JSON, authed)",
    badSummary.status,
    await badSummary.text(),
  )

  const summaryOk = await req(
    "POST",
    "/api/v1/agent/summary",
    {
      date: "2026-05-04",
      tasks: [],
    },
    authHeaders,
  )
  console.log(
    "POST /api/v1/agent/summary (authed)",
    summaryOk.status,
    await summaryOk.text(),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
