import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ApiKey, findKey } from "./auth.js";
import type { Sql } from "./db.js";
import { receive } from "./ingest.js";

export function createApp(sql: Sql) {
  const app = new Hono<{ Variables: { apiKey: ApiKey } }>();

  app.onError((error, c) => {
    console.error(JSON.stringify({ path: c.req.path, error: String(error) }));
    return c.json({ error: { code: "internal_error", message: "Unexpected error" } }, 500);
  });

  app.get("/health", async (c) => {
    await sql`select 1`;
    return c.json({ status: "ok" });
  });

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("x-api-key");
    const apiKey = header ? await findKey(sql, header) : undefined;
    if (!apiKey) return c.json({ error: { code: "unauthorized", message: "Missing or unknown x-api-key" } }, 401);
    c.set("apiKey", apiKey);
    await next();
  });

  app.post(
    "/api/webhook/tive",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: { code: "payload_too_large", message: "Body is over 64 KB" } }, 413),
    }),
    async (c) => {
      const started = performance.now();
      const payload = await c.req.json().catch(() => null);
      if (payload === null) {
        return c.json({ error: { code: "invalid_json", message: "Body must be JSON and not null" } }, 400);
      }

      const apiKey = c.get("apiKey");
      const { status, body } = await receive(sql, apiKey, payload);
      const ms = Math.round(performance.now() - started);
      console.log(JSON.stringify({ event_id: body.event_id, key: apiKey.name, status, outcome: body.status, ms }));
      return c.json(body, status);
    },
  );

  return app;
}
