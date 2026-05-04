import { handle } from "hono/vercel"
import { Hono } from "hono"
import { agentRoute } from "../src/routes/agent"
import { healthRoute } from "../src/routes/health"

export const app = new Hono().basePath("/api/v1")

app.route("/", agentRoute)
app.route("/", healthRoute)

app.notFound((c) =>
  c.json({ ok: false, error: "not_found", path: c.req.path }, 404),
)

/** Node runtime: YAML prompts are read from `src/prompts/` (see vercel.json `includeFiles`). */
export const config = { runtime: "nodejs" }

export default handle(app)
