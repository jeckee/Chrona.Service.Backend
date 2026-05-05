/**
 * Load `.env.local` into `process.env` when keys are unset (for smoke / local runs).
 * Import this module before any code that reads Supabase env vars.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const envPath = resolve(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim()
    if (t === "" || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}
