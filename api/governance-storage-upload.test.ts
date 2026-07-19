import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Governance storage upload client behavior", () => {
  function setupVM() {
    const fetchCalls: Array<{ url: string; options: any }> = [];
    const deferredResolves: Map<string, (value: any) => void> = new Map();
    const localStorageData = new Map<string, string>();
    const localStorageCalls: Array<{ method: string; args: any[] }> = [];

    const mockFetch = (url: string, options: any) => {
      fetchCalls.push({ url, options });
      return new Promise((resolve) => {
        deferredResolves.set(url, resolve);
      });
    };

    const localStorage = {
      getItem: (key: string) => {
        localStorageCalls.push({ method: "getItem", args: [key] });
        return localStorageData.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        localStorageCalls.push({ method: "setItem", args: [key, value] });
        localStorageData.set(key, value);
      },
      removeItem: (key: string) => {
        localStorageCalls.push({ method: "removeItem", args: [key] });
        localStorageData.delete(key);
      },
    };

    const tus = {
      Upload: function(file: any, options: any) {
        return {
          start: () => {
            setTimeout(() => {
              if (options.onSuccess) options.onSuccess();
            }, 10);
          },
          findPreviousUploads: () => Promise.resolve([]),
          abort: () => Promise.resolve(),
        };
      },
    };

    // window object - this becomes `global` inside the VM
    const windowObj: any = {
      localStorage,
      tus,
    };

    const context: any = {
      window: windowObj,
      localStorage,
      fetch: mockFetch,
      tus,
      AbortController: global.AbortController,
      DOMException: global.DOMException,
      Promise: global.Promise,
      JSON: global.JSON,
      Date: global.Date,
      Error: global.Error,
      setTimeout: (...args: any[]) => (global.setTimeout as any)(...args),
      clearTimeout: (...args: any[]) => (global.clearTimeout as any)(...args),
      console: { log: () => {}, error: () => {}, warn: () => {} },
    };

    const filePath = join(__dirname, "../public/governance-storage-upload.js");
    const code = readFileSync(filePath, "utf-8");
    runInNewContext(code, context);

    return {
      window: windowObj,
      fetchCalls,
      deferredResolves,
      localStorageData,
      localStorageCalls,
    };
  }

  function resolveFetch(deferredResolves: Map<string, (value: any) => void>, url: string, response: any) {
    const resolve = deferredResolves.get(url);
    if (resolve) {
      resolve(response);
      deferredResolves.delete(url);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fresh authorization stores no capabilityToken in localStorage", async () => {
    const { window, fetchCalls, deferredResolves, localStorageCalls } = setupVM();

    const authResponse = {
      intentId: "intent-fresh-123",
      capabilityToken: "secret-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    // Wait for config fetch
    await new Promise(r => setTimeout(r, 50));
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);

    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    // Wait for authorize fetch
    await new Promise(r => setTimeout(r, 50));
    expect(fetchCalls.some(c => c.url === "/api/storage/uploads/authorize")).toBe(true);

    resolveFetch(deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    // Wait for TUS and finalize
    await new Promise(r => setTimeout(r, 200));

    // Check localStorage was written
    expect(localStorageCalls.some(c => c.method === "setItem")).toBe(true);

    const setItemCall = localStorageCalls.find(c => c.method === "setItem");
    const [, storedValue] = setItemCall!.args;
    const parsed = JSON.parse(storedValue);
    expect(parsed.capabilityToken).toBeUndefined();
    expect(storedValue).not.toContain("secret-cap-token");
    expect(parsed.intentId).toBe("intent-fresh-123");
  });

  it("finalize request includes the capabilityToken", async () => {
    const { window, fetchCalls, deferredResolves } = setupVM();

    const authResponse = {
      intentId: "intent-finalize-456",
      capabilityToken: "finalize-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 200));

    const finalizeCall = fetchCalls.find(c => c.url === "/api/storage/uploads/finalize");
    expect(finalizeCall).toBeDefined();
    const body = JSON.parse(finalizeCall!.options.body);
    expect(body.capabilityToken).toBe("finalize-cap-token");
    expect(body.intentId).toBe("intent-finalize-456");
  });

  it("same-page resume includes the in-memory capabilityToken", async () => {
    const { window, fetchCalls, deferredResolves, localStorageCalls } = setupVM();

    const authResponse = {
      intentId: "intent-resume-789",
      capabilityToken: "resume-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // First upload
    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 200));

    // Verify localStorage was saved
    expect(localStorageCalls.some(c => c.method === "setItem")).toBe(true);

    // Second upload - should resume
    fetchCalls.length = 0;
    deferredResolves.clear();
    localStorageCalls.length = 0;

    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 100));

    const resumeCall = fetchCalls.find(c => c.url === "/api/storage/uploads/resume");
    expect(resumeCall).toBeDefined();
    const body = JSON.parse(resumeCall!.options.body);
    expect(body.capabilityToken).toBe("resume-cap-token");
  });

  it("page refresh with cached auth but no memory token never calls /resume", async () => {
    const vm1 = setupVM();

    const authResponse = {
      intentId: "intent-refresh-abc",
      capabilityToken: "refresh-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // First upload
    vm1.window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(vm1.deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(vm1.deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 200));

    // Verify localStorage was saved
    expect(vm1.localStorageCalls.some(c => c.method === "setItem")).toBe(true);

    // Create fresh VM (simulates page refresh) with same localStorage data
    const vm2 = setupVM();
    vm1.localStorageData.forEach((value, key) => {
      vm2.localStorageData.set(key, value);
    });

    // Try upload in new VM - should NOT resume
    vm2.window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(vm2.deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 100));

    const resumeCalls = vm2.fetchCalls.filter(c => c.url === "/api/storage/uploads/resume");
    expect(resumeCalls.length).toBe(0);

    // Should call /authorize instead
    expect(vm2.fetchCalls.some(c => c.url === "/api/storage/uploads/authorize")).toBe(true);

    // Should have removed stale cached auth
    expect(vm2.localStorageCalls.some(c => c.method === "removeItem")).toBe(true);
  });

  it("abandon includes the capabilityToken in request", async () => {
    const { window, fetchCalls, deferredResolves } = setupVM();

    const authResponse = {
      intentId: "intent-abandon-abc",
      capabilityToken: "abandon-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const abortController = new AbortController();

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // Start upload but catch the expected abort error
    const uploadPromise = window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), abortController.signal);
    uploadPromise.catch(() => {}); // Ignore the abort error

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    await new Promise(r => setTimeout(r, 50));
    resolveFetch(deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    abortController.abort();

    await new Promise(r => setTimeout(r, 100));

    const abandonCall = fetchCalls.find(c => c.url === "/api/storage/uploads/abandon");
    expect(abandonCall).toBeDefined();
    const body = JSON.parse(abandonCall!.options.body);
    expect(body.capabilityToken).toBe("abandon-cap-token");
    expect(body.intentId).toBe("intent-abandon-abc");
  });

  it("successful finalize clears the in-memory token", async () => {
    const { window, fetchCalls, deferredResolves, localStorageData, localStorageCalls } = setupVM();

    const authResponse = {
      intentId: "intent-cleanup-xyz",
      capabilityToken: "cleanup-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
      storageEnabled: true,
    };

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // First upload - start but don't await
    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    // Wait for config and resolve
    await new Promise(r => setTimeout(r, 50));
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    // Wait for authorize and resolve
    await new Promise(r => setTimeout(r, 50));
    expect(fetchCalls.some(c => c.url === "/api/storage/uploads/authorize")).toBe(true);
    resolveFetch(deferredResolves, "/api/storage/uploads/authorize", {
      ok: true,
      json: () => Promise.resolve(authResponse),
      status: 200,
    });

    // Wait for TUS success and finalize call
    await new Promise(r => setTimeout(r, 200));
    expect(fetchCalls.some(c => c.url === "/api/storage/uploads/finalize")).toBe(true);

    // setItem was called before finalize - check localStorage calls now
    const setItemCalls = localStorageCalls.filter(c => c.method === "setItem");
    expect(setItemCalls.length).toBeGreaterThan(0);
    const lastSetItem = setItemCalls[setItemCalls.length - 1];
    const resumeKey = lastSetItem.args[0];
    const cachedAuthWithoutToken = JSON.parse(lastSetItem.args[1]);

    // Verify localStorage saved intentId but no capabilityToken
    expect(cachedAuthWithoutToken.intentId).toBe("intent-cleanup-xyz");
    expect(cachedAuthWithoutToken.capabilityToken).toBeUndefined();

    // Resolve finalize to trigger token cleanup
    resolveFetch(deferredResolves, "/api/storage/uploads/finalize", {
      ok: true,
      json: () => Promise.resolve({ success: true }),
      status: 200,
    });

    // Wait for localStorage removeItem to be called (finalize clears the cache)
    await new Promise(r => setTimeout(r, 100));
    expect(localStorageCalls.some(c => c.method === "removeItem")).toBe(true);

    // Clear fetch tracking for second upload
    fetchCalls.length = 0;
    deferredResolves.clear();

    // Manually reinsert cached authorization (simulating page refresh with stored auth)
    // The cached auth has NO capabilityToken since it was never stored in localStorage
    localStorageData.set(resumeKey, JSON.stringify(cachedAuthWithoutToken));

    // Second upload in SAME VM - should NOT resume because memory token was cleared
    window.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    // Wait for config and resolve
    await new Promise(r => setTimeout(r, 50));
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    resolveFetch(deferredResolves, "/api/storage/config", {
      ok: true,
      json: () => Promise.resolve({ flags: { global: true, governance: true } }),
      status: 200,
    });

    // Wait for the next authorize call (not resume) - this proves memory token was cleared
    await new Promise(r => setTimeout(r, 100));
    expect(fetchCalls.some(c => c.url === "/api/storage/uploads/authorize")).toBe(true);

    // Should NOT have called /resume because memory token was cleared by finalize
    const resumeCalls = fetchCalls.filter(c => c.url === "/api/storage/uploads/resume");
    expect(resumeCalls.length).toBe(0);
  });
});
