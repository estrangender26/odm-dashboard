import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { installRequestBodyGuard } from "./request-body-guard";
import { getRequestBodyLimitConfig, SHARED_GANTT_BODY_LIMIT_BYTES } from "./upload-body-limit";

function makeApp() {
  const app = new Hono();
  installRequestBodyGuard(app, getRequestBodyLimitConfig);
  app.post("/api/trpc/sharedGantt.createShared", async (c) => {
    // Force body consumption so the stream guard can detect oversized bodies.
    await c.req.text();
    return c.json({ ok: true });
  });
  return app;
}

describe("request body guard for sharedGantt", () => {
  it("rejects a request with content-length above the sharedGantt limit", async () => {
    const app = makeApp();
    const req = new Request("http://localhost/api/trpc/sharedGantt.createShared", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(SHARED_GANTT_BODY_LIMIT_BYTES + 1),
      },
      body: "x",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(413);
  });

  it("accepts a request at exactly the sharedGantt limit", async () => {
    const app = makeApp();
    const body = "x".repeat(SHARED_GANTT_BODY_LIMIT_BYTES);
    const req = new Request("http://localhost/api/trpc/sharedGantt.createShared", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
  });

  it("rejects a streaming body that exceeds the limit", async () => {
    const app = makeApp();
    const body = "x".repeat(SHARED_GANTT_BODY_LIMIT_BYTES + 1);
    const req = new Request("http://localhost/api/trpc/sharedGantt.createShared", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(413);
  });
});
