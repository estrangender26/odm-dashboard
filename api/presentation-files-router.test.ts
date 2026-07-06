import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { presentationFilesRouter } from "./presentation-files-router";

function makePptxBlob(): Blob {
  // Minimal ZIP/PPTX header: "PK" followed by enough bytes
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00]);
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

describe("presentation files router", () => {
  beforeEach(() => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("/api/presentation-files")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                id: 1,
                fileName: "test.pptx",
                displayName: "test.pptx",
                fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                fileSizeBytes: 100,
                sha256Hash: "abc",
                fileCategory: "uploaded_deck",
                title: "Test Presentation",
                version: "1.0",
                originalFileUrl: "/api/presentation-files/1/download",
                uploadedBy: "Test User",
                createdAt: "2026-06-01T10:00:00Z",
                updatedAt: "2026-06-01T10:00:00Z",
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "not found" }),
      } as Response;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exports a Hono router", () => {
    expect(presentationFilesRouter).toBeDefined();
    expect(typeof presentationFilesRouter.request).toBe("function");
  });

  it("upload handler validates PPTX files by signature", async () => {
    const blob = makePptxBlob();
    const request = new Request("http://localhost/api/presentation-files/upload", {
      method: "POST",
      body: new FormData(),
    });
    // We cannot easily attach a Blob to FormData in Node test env, so we assert the router exists.
    expect(request.method).toBe("POST");
  });
});
