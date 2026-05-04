import { Hono } from "hono";
import { healthRoute } from "./routes/health";

export const app = new Hono().basePath("/api");

app.route("/v1", healthRoute);

app.notFound((c) =>
  c.json({ ok: false, error: "not_found", path: c.req.path }, 404),
);
