import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/health", (c) =>
  c.json({
    ok: true,
    service: "chrona-api",
    version: "v1",
  }),
);
