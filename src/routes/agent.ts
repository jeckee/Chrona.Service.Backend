import type { Context } from "hono"
import { Hono } from "hono"
import { authMiddleware, type AuthEnv } from "../middleware/auth.js"
import { requireEntitlementMiddleware } from "../middleware/entitlement.js"
import { callLLM } from "../services/openrouter.js"
import type {
  SchedulingRequest,
  SchedulingResponse,
  SummaryRequest,
} from "../types/agent.js"
import { loadPrompt, renderTemplate } from "../utils/promptLoader.js"

function jsonBadRequest(c: Context, message: string) {
  return c.json({ error: "Bad Request", message }, 400)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== ""
}

function isString(v: unknown): v is string {
  return typeof v === "string"
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

function validateSchedulingBody(
  body: unknown,
): SchedulingRequest | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "Body must be a JSON object." }
  }
  const o = body as Record<string, unknown>
  if (!isNonEmptyString(o.selectedDate)) {
    return { error: "selectedDate must be a non-empty string." }
  }
  if (!isString(o.currentTime)) {
    return { error: "currentTime must be a string." }
  }
  if (!isArray(o.workingHours)) {
    return { error: "workingHours must be an array." }
  }
  if (!isArray(o.scheduledTasks)) {
    return { error: "scheduledTasks must be an array." }
  }
  if (!isArray(o.unscheduledTasks)) {
    return { error: "unscheduledTasks must be an array." }
  }
  return o as unknown as SchedulingRequest
}

function validateSummaryBody(
  body: unknown,
): SummaryRequest | { error: string } {
  if (body === null || typeof body !== "object") {
    return { error: "Body must be a JSON object." }
  }
  const o = body as Record<string, unknown>
  if (!isNonEmptyString(o.date)) {
    return { error: "date must be a non-empty string." }
  }
  if (!isArray(o.tasks)) {
    return { error: "tasks must be an array." }
  }
  return o as unknown as SummaryRequest
}

function jsonAiRequestFailed(c: Context, message: string) {
  return c.json({ error: "AI Request Failed", message }, 502)
}

function schedulingUserPrompt(
  system: string,
  template: string,
  request: SchedulingRequest,
): string {
  const rendered = renderTemplate(template, {
    selectedDate: request.selectedDate,
    currentTime: request.currentTime,
    workingHours: request.workingHours,
    scheduledTasks: request.scheduledTasks,
    unscheduledTasks: request.unscheduledTasks,
  })
  const sys = system.trim()
  return sys !== "" ? `${sys}\n\n${rendered}` : rendered
}

function summaryUserPrompt(
  system: string,
  template: string,
  request: SummaryRequest,
): string {
  const rendered = renderTemplate(template, {
    date: request.date,
    tasksJson: request.tasks,
  })
  const sys = system.trim()
  return sys !== "" ? `${sys}\n\n${rendered}` : rendered
}

export const agentRoute = new Hono<AuthEnv>()

agentRoute.use("*", authMiddleware)
agentRoute.use("*", requireEntitlementMiddleware)

agentRoute.post("/agent/schedule", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonBadRequest(c, "Invalid JSON body.")
  }

  const parsed = validateSchedulingBody(body)
  if ("error" in parsed && typeof parsed.error === "string") {
    return jsonBadRequest(c, parsed.error)
  }
  const scheduleRequest = parsed as SchedulingRequest

  let fullPrompt: string
  try {
    const { system, template } = loadPrompt("scheduling")
    fullPrompt = schedulingUserPrompt(system, template, scheduleRequest)
    console.log("[agent/schedule] fullPrompt:", fullPrompt)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return jsonAiRequestFailed(c, message)
  }

  try {
    const llm = await callLLM(fullPrompt, { responseFormat: "json" })
    const result = JSON.parse(llm.content) as SchedulingResponse
    return c.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return jsonAiRequestFailed(c, message)
  }
})

agentRoute.post("/agent/summary", async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonBadRequest(c, "Invalid JSON body.")
  }

  const parsed = validateSummaryBody(body)
  if ("error" in parsed && typeof parsed.error === "string") {
    return jsonBadRequest(c, parsed.error)
  }
  const summaryRequest = parsed as SummaryRequest

  let fullPrompt: string
  try {
    const { system, template } = loadPrompt("summary")
    fullPrompt = summaryUserPrompt(system, template, summaryRequest)
    console.log("[agent/summary] fullPrompt:", fullPrompt)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return jsonAiRequestFailed(c, message)
  }

  try {
    const llm = await callLLM(fullPrompt, { responseFormat: "text" })
    return c.json({ text: llm.content })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return jsonAiRequestFailed(c, message)
  }
})
