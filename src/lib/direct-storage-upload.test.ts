import { beforeEach, describe, expect, it, vi } from "vitest";

const tusState = vi.hoisted(() => ({
  instances: [] as Array<{
    options: any;
    resumed: unknown[];
  }>,
}));

vi.mock("tus-js-client", () => ({
  Upload: class MockUpload {
    options: any;
    resumed: unknown[] = [];

    constructor(_file: unknown, options: any) {
      this.options = options;
      tusState.instances.push(this);
    }

    findPreviousUploads() {
      return Promise.resolve(tusState.instances.length > 1 ? [{ uploadUrl: "https://storage.example.test/resume" }] : []);
    }

    resumeFromPreviousUpload(previous: unknown) {
      this.resumed.push(previous);
    }

    start() {
      queueMicrotask(() => this.options.onError(new Error("temporary network failure")));
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(authorization), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tusState.instances).toHaveLength(2);
    expect(tusState.instances[1].resumed).toHaveLength(1);
    const firstFingerprint = await tusState.instances[0].options.fingerprint();
    const secondFingerprint = await tusState.instances[1].options.fingerprint();
    expect(secondFingerprint).toBe(firstFingerprint);
  });
});
