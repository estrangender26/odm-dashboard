import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  MAX_BASE64_UPLOAD_BODY_SIZE_BYTES,
  MAX_MULTIPART_UPLOAD_BODY_SIZE_BYTES,
  MAX_UPLOAD_ERROR_MESSAGE,
} from "@contracts/upload-limits";
import { installRequestBodyGuard } from "./request-body-guard";

function makeUnreadBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
}

describe("request body guard", () => {
  it("rejects an oversized multipart Content-Length without parsing the body", async () => {
    const app = new Hono();
    let handlerCalls = 0;
    installRequestBodyGuard(app);
    app.post("/api/documents/upload", () => {
      handlerCalls++;
      return new Response("unexpected");
    });

    const request = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test",
        "content-length": String(MAX_MULTIPART_UPLOAD_BODY_SIZE_BYTES + 1),
      },
      body: makeUnreadBody(),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.fetch(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: MAX_UPLOAD_ERROR_MESSAGE });
    expect(handlerCalls).toBe(0);
  });

  it("rejects an oversized base64 Content-Length before tRPC JSON parsing", async () => {
    const app = new Hono();
    let handlerCalls = 0;
    installRequestBodyGuard(app);
    app.post("/api/trpc/smp.update", async (c) => {
      handlerCalls++;
      await c.req.json();
      return c.json({ ok: true });
    });

    const request = new Request("http://localhost/api/trpc/smp.update", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_BASE64_UPLOAD_BODY_SIZE_BYTES + 1),
      },
      body: makeUnreadBody(),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.fetch(request);
    const payload = await response.json() as { error: { json: { message: string } } };

    expect(response.status).toBe(413);
    expect(payload.error.json.message).toBe(MAX_UPLOAD_ERROR_MESSAGE);
    expect(handlerCalls).toBe(0);
  });

  it("counts a missing-Content-Length stream and returns 413 at the cap", async () => {
    const app = new Hono();
    let handlerCompleted = false;
    installRequestBodyGuard(app, () => ({
      maxSizeBytes: 4,
      errorMessage: MAX_UPLOAD_ERROR_MESSAGE,
      isAffectedUpload: true,
    }));
    app.post("/api/documents/upload", async (c) => {
      await c.req.arrayBuffer();
      handlerCompleted = true;
      return c.json({ ok: true });
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await app.fetch(request);

    expect(response.status).toBe(413);
    expect(await response.text()).toContain(MAX_UPLOAD_ERROR_MESSAGE);
    expect(handlerCompleted).toBe(false);
  });

  it("allows a missing-Content-Length stream exactly at the cap", async () => {
    const app = new Hono();
    installRequestBodyGuard(app, () => ({
      maxSizeBytes: 4,
      errorMessage: MAX_UPLOAD_ERROR_MESSAGE,
      isAffectedUpload: true,
    }));
    app.post("/upload", async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }));

    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });
    request.headers.delete("content-length");
    const response = await app.fetch(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: 4 });
  });

  it("rejects invalid Content-Length values", async () => {
    const app = new Hono();
    let handlerCalls = 0;
    installRequestBodyGuard(app);
    app.post("/api/documents/upload", () => {
      handlerCalls++;
      return new Response("unexpected");
    });
    const request = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      headers: { "content-length": "unsafe" },
      body: "x",
    });

    const response = await app.fetch(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid Content-Length.");
    expect(handlerCalls).toBe(0);
  });
});
