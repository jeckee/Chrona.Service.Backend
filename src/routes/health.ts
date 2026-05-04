import { Hono } from "hono";

/** 新版本在此并列加一条路径即可，例如 get("/v2/health", ...) */
export const healthRoute = new Hono();

healthRoute.get("/v1/health", (c) =>
  c.json({
    ok: true,
    service: "chrona-api",
    version: "v1",
  }),
);
