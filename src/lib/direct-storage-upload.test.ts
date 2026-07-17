import { beforeEach, describe, expect, it, vi } from "vitest";

const tusState = vi.hoisted(() => ({
  instances: [] as Array<{
    options: any;
    resumed: unknown[];
  }>,
  behavior: "error" as "error" | "wait",
  abortCalls: 0,
}));

vi.mock("tus-js-client", () => ({
  Upload: class MockUpload {
    options: any;
    resumed: unknown[] = [];

    constructor(_file: unknown, options: any) {
      this.options = options;
      tusState.instances.push(this);
    }

    async findPreviousUploads() {
      if (tusState.instances.length <= 1) return [];
      const current = await this.options.fingerprint();
      const previous = await tusState.instances[0].options.fingerprint();
      return current === previous ? [{ uploadUrl: "https://storage.example.test/resume" }] : [];
    }

    resumeFromPreviousUpload(previous: unknown) {
      this.resumed.push(previous);
    }

    start() {
      if (tusState.behavior === "error") queueMicrotask(() => this.options.onError(new Error("temporary network failure")));
    }

    abort() {
      tusState.abortCalls += 1;
      return Promise.resolve();
    }
  },
}));

import { uploadFileDirect } from "./direct-storage-upload";

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("direct Storage resumability", () => {
  beforeEach(() => {
    tusState.instances.length = 0;
    tusState.behavior = "error";
    tusState.abortCalls = 0;
    vi.restoreAllMocks();
    vi.stubGlobal("window", { localStorage: createLocalStorage() });
  });

  it("reuses the same authorization and TUS upload after a transient failure", async () => {
    const authorization = {
      storageEnabled: true,
      intentId: "11111111-1111-4111-8111-111111111111",
      endpoint: "https://storage.example.test/storage/v1/upload/resumable",
      token: "scoped-upload-token",
      bucket: "om-manuals",
      path: "v1/folder-1/object-id",
      chunkSize: 6 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(authorization), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const file = {
      name: "manual.pdf",
      type: "application/pdf",
      size: 1024,
      lastModified: 123456,
    } as File;
    const options = { module: "om" as const, file, target: { folderId: 1 } };

    await expect(uploadFileDirect(options)).rejects.toThrow("temporary network failure");
    await expect(uploadFileDirect(options)).rejects.toThrow("temporary network failure");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/storage/uploads/resume");
    expect(tusState.instances).toHaveLength(2);
    expect(tusState.instances[1].resumed).toHaveLength(1);
    const firstFingerprint = await tusState.instances[0].options.fingerprint();
    const secondFingerprint = await tusState.instances[1].options.fingerprint();
    expect(secondFingerprint).toBe(firstFingerprint);
  });

  it("does not resume a cached fingerprint when the current user cannot reclaim its intent", async () => {
    const first = {
      storageEnabled: true, intentId: "11111111-1111-4111-8111-111111111111",
      endpoint: "https://storage.example.test/storage/v1/upload/resumable", token: "first-token",
      bucket: "om-manuals", path: "v1/folder-1/first", chunkSize: 6 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const second = { ...first, intentId: "22222222-2222-4222-8222-222222222222", token: "second-token", path: "v1/folder-1/second" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Upload intent not found." }), { status: 404, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = { name: "manual.pdf", type: "application/pdf", size: 1024, lastModified: 123456 } as File;
    const options = { module: "om" as const, file, target: { folderId: 1 } };

    await expect(uploadFileDirect(options)).rejects.toThrow("temporary network failure");
    await expect(uploadFileDirect(options)).rejects.toThrow("temporary network failure");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(tusState.instances[1].resumed).toHaveLength(0);
    expect(await tusState.instances[1].options.fingerprint()).not.toBe(await tusState.instances[0].options.fingerprint());
  });

  it("aborts TUS and marks the intent abandoned when explicitly cancelled", async () => {
    tusState.behavior = "wait";
    const authorization = {
      storageEnabled: true, intentId: "11111111-1111-4111-8111-111111111111",
      endpoint: "https://storage.example.test/storage/v1/upload/resumable", token: "scoped-upload-token",
      bucket: "om-manuals", path: "v1/folder-1/object-id", chunkSize: 6 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(authorization), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = uploadFileDirect({
      module: "om",
      file: { name: "manual.pdf", type: "application/pdf", size: 1024, lastModified: 123456 } as File,
      target: { folderId: 1 },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(tusState.instances).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(tusState.abortCalls).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/storage/uploads/abandon")).toBe(true);
  });
});
