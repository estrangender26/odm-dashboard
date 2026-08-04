import { describe, expect, it } from "vitest";
import {
  AI_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  getRequestTimeoutMs,
  isAiChatRequestUrl,
  isLargeUploadRequestUrl,
} from "./requestTimeout";

describe("requestTimeout URL classification", () => {
  it("identifies ai.maintenanceChat as an AI chat request", () => {
    expect(isAiChatRequestUrl("/api/trpc/ai.maintenanceChat?batch=1")).toBe(true);
    expect(isAiChatRequestUrl("/api/trpc/ai.status")).toBe(false);
    expect(isAiChatRequestUrl("/api/trpc/ai.health")).toBe(false);
  });

  it("identifies large upload procedures", () => {
    expect(isLargeUploadRequestUrl("/api/trpc/documents.uploadFile")).toBe(true);
    expect(isLargeUploadRequestUrl("/api/trpc/governance.addUpload")).toBe(true);
    expect(isLargeUploadRequestUrl("/api/trpc/ai.maintenanceChat")).toBe(false);
  });
});

describe("getRequestTimeoutMs", () => {
  it("gives AI chat requests a timeout exceeding the server Ollama timeout", () => {
    const result = getRequestTimeoutMs({ requestUrl: "/api/trpc/ai.maintenanceChat?batch=1" });
    expect(result.timeoutMs).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(result.timeoutMs).toBeGreaterThan(120_000);
    expect(result.timeoutDisabled).toBe(false);
  });

  it("gives default requests a short timeout", () => {
    const result = getRequestTimeoutMs({ requestUrl: "/api/trpc/auth.me" });
    expect(result.timeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(result.timeoutDisabled).toBe(false);
  });

  it("gives import requests an adaptive timeout", () => {
    const result = getRequestTimeoutMs({
      requestUrl: "/api/trpc/tasks.import",
      body: JSON.stringify({ json: { rows: new Array(500).fill({}) } }),
    });
    expect(result.timeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(result.timeoutDisabled).toBe(false);
    expect(result.payloadRows).toBe(500);
  });

  it("gives upload requests a long timeout", () => {
    const result = getRequestTimeoutMs({ requestUrl: "/api/trpc/documents.uploadFile" });
    expect(result.timeoutMs).toBe(600_000);
    expect(result.timeoutDisabled).toBe(false);
  });
});
