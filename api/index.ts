import type { IncomingMessage, ServerResponse } from "node:http"
import { Hono } from "hono"
import { agentRoute } from "../src/routes/agent.js"
import { billingRoute } from "../src/routes/billing.js"
import { healthRoute } from "../src/routes/health.js"
import { meRoute } from "../src/routes/me.js"

export const app = new Hono().basePath("/api/v1")

app.route("/", healthRoute)
app.route("/", meRoute)
app.route("/", agentRoute)
app.route("/", billingRoute)

app.notFound((c) =>
  c.json({ ok: false, error: "not_found", path: c.req.path }, 404),
)

/** YAML prompts are read at runtime from `src/prompts/` (see vercel.json `includeFiles`). */
export const runtime = "nodejs"

function readNodeBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

async function nodeReqToWebRequest(req: IncomingMessage): Promise<Request> {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "http"
  const host = (req.headers.host as string | undefined) ?? "localhost"
  const url = new URL(req.url ?? "/", `${proto}://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (typeof value === "string") {
      headers.set(key, value)
    }
  }

  const method = (req.method ?? "GET").toUpperCase()
  const init: Record<string, unknown> = { method, headers }
  if (method !== "GET" && method !== "HEAD") {
    const buf = await readNodeBody(req)
    if (buf.byteLength > 0) init.body = buf
  }
  return new Request(url, init as RequestInit)
}

async function writeWebResponseToNode(
  webRes: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = webRes.status
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (webRes.body == null) {
    res.end()
    return
  }
  const buffer = Buffer.from(await webRes.arrayBuffer())
  res.end(buffer)
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const webReq = await nodeReqToWebRequest(req)
    const webRes = await app.fetch(webReq)
    await writeWebResponseToNode(webRes, res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.statusCode = 500
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ error: "Internal Server Error", message }))
  }
}
