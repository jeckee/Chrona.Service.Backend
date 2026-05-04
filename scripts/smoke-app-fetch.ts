/**
 * Smoke test via Hono app.fetch() (no Vercel CLI).
 * Run: npx tsx scripts/smoke-app-fetch.ts
 */
import { app } from "../src/app"

async function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" }
    init.body = JSON.stringify(body)
  }
  return app.request(`http://test${path}`, init)
}

async function main() {
  const health = await req("GET", "/api/v1/health")
  console.log("GET /api/v1/health", health.status, await health.text())

  const badSchedule = await req("POST", "/api/v1/agent/schedule", {
    selectedDate: "",
    currentTime: "x",
    workingHours: [],
    scheduledTasks: [],
    unscheduledTasks: [],
  })
  console.log(
    "POST /api/v1/agent/schedule (invalid)",
    badSchedule.status,
    await badSchedule.text(),
  )

  const scheduleOk = await req("POST", "/api/v1/agent/schedule", {
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
  })
  console.log(
    "POST /api/v1/agent/schedule (mock)",
    scheduleOk.status,
    await scheduleOk.text(),
  )

  try {
    const badSummary = await app.request("http://test/api/v1/agent/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    console.log(
      "POST /api/v1/agent/summary (invalid JSON)",
      badSummary.status,
      await badSummary.text(),
    )
  } catch (e) {
    console.log("POST /api/v1/agent/summary (invalid JSON) threw:", e)
    return
  }

  const summaryOk = await req("POST", "/api/v1/agent/summary", {
    date: "2026-05-04",
    tasks: [],
  })
  console.log(
    "POST /api/v1/agent/summary (mock)",
    summaryOk.status,
    await summaryOk.text(),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
