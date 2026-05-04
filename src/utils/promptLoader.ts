import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

export type PromptYaml = {
  system: string
  template: string
}

const promptCache: Partial<Record<"scheduling" | "summary", PromptYaml>> = {}

export function loadPrompt(name: "scheduling" | "summary"): PromptYaml {
  const cached = promptCache[name]
  if (cached !== undefined) {
    return cached
  }
  const path = join(process.cwd(), "src", "prompts", `${name}.yaml`)
  const raw = readFileSync(path, "utf8")
  const doc = parse(raw) as { system?: string; template?: string }
  if (typeof doc.template !== "string" || doc.template.trim() === "") {
    throw new Error(
      `src/prompts/${name}.yaml must define a non-empty "template" string`,
    )
  }
  const result: PromptYaml = {
    system: typeof doc.system === "string" ? doc.system : "",
    template: doc.template,
  }
  promptCache[name] = result
  return result
}

function formatTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

export function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  let out = template
  for (const [key, value] of Object.entries(data)) {
    out = out.replaceAll(`{{${key}}}`, formatTemplateValue(value))
  }
  return out
}
