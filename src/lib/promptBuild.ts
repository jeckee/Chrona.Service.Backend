import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import type { SchedulingRequest, SummaryRequest } from "../types/agent"

type PromptDoc = {
  system: string
  template: string
}

const promptDocCache: Partial<Record<"scheduling" | "summary", PromptDoc>> = {}

function loadPromptDoc(name: "scheduling" | "summary"): PromptDoc {
  const hit = promptDocCache[name]
  if (hit !== undefined) return hit
  const path = join(process.cwd(), "src", "prompts", `${name}.yaml`)
  const raw = readFileSync(path, "utf8")
  const doc = parse(raw) as { system?: string; template?: string }
  if (typeof doc.template !== "string" || doc.template.trim() === "") {
    throw new Error(
      `src/prompts/${name}.yaml must define a non-empty "template" string`,
    )
  }
  const parsed: PromptDoc = {
    system: typeof doc.system === "string" ? doc.system : "",
    template: doc.template,
  }
  promptDocCache[name] = parsed
  return parsed
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value)
  }
  return out
}

/** Recursively sort object keys for stable JSON (Swift .sortedKeys style). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2)
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key])
  }
  return sorted
}

export function buildSchedulingPrompt(request: SchedulingRequest): string {
  const doc = loadPromptDoc("scheduling")
  const workingHours = stableStringify(request.workingHours)
  const scheduledTasks = stableStringify(request.scheduledTasks)
  const unscheduledTasks = stableStringify(request.unscheduledTasks)
  const filled = fillTemplate(doc.template, {
    selectedDate: request.selectedDate,
    currentTime: request.currentTime,
    workingHours,
    scheduledTasks,
    unscheduledTasks,
  })
  const sys = doc.system.trim()
  return sys !== "" ? `${sys}\n\n${filled}` : filled
}

export function buildSummaryPrompt(request: SummaryRequest): string {
  const doc = loadPromptDoc("summary")
  const tasksJson = stableStringify(request.tasks)
  const filled = fillTemplate(doc.template, {
    date: request.date,
    tasksJson,
  })
  const sys = doc.system.trim()
  return sys !== "" ? `${sys}\n\n${filled}` : filled
}
