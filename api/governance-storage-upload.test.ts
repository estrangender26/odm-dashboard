import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Execute the client module in a sandboxed context
function executeClientInSandbox(sandbox: Record<string, any>): void {
  const fs = require("fs");
  const path = require("path");
  const filePath = path.join(__dirname, "../public/governance-storage-upload.js");
  let code = fs.readFileSync(filePath, "utf-8");

  // Replace the IIFE pattern: (function(global){ ... })(window);
  // with: (function(sandbox){ ... })(sandbox);
  code = code.replace(/\(function\(global\)\{/g, "(function(sandbox){");
  code = code.replace(/\)\(window\);\s*$/g, ")(sandbox);");

  // Replace all global. references with sandbox.
  code = code.replace(/\bglobal\./g, "sandbox.");

  // Replace bare fetch calls with sandbox.fetch
  code = code.replace(/(?<!\w\.)(?<!\w)fetch\(/g, "sandbox.fetch(");

  const fn = new Function("sandbox", code);
  fn(sandbox);
}

describe("Governance storage upload client behavior", () => {
  let mockLocalStorage: Map<string, string>;
  let fetchCalls: Array<{ url: string; options: any }>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let sandbox: Record<string, any>;

  beforeEach(() => {
    mockLocalStorage = new Map();
    fetchCalls = [];

    // Create mock fetch that captures calls
    mockFetch = vi.fn((url: string, options: any) => {
      fetchCalls.push({ url, options });
      // Return a pending promise that never resolves to prevent further execution
      return new Promise(() => {});
    });

    // Create sandbox with mocked globals
    sandbox = {
      localStorage: {
        getItem: vi.fn((key: string) => mockLocalStorage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => mockLocalStorage.set(key, value)),
        removeItem: vi.fn((key: string) => mockLocalStorage.delete(key)),
      },
      fetch: mockFetch,
      tus: { Upload: vi.fn().mockImplementation(function() { return { start: () => {}, findPreviousUploads: () => Promise.resolve([]), abort: () => Promise.resolve() }; }) },
      DOMException: global.DOMException,
    };

    // Execute the client code
    executeClientInSandbox(sandbox);
  });

  afterEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    mockLocalStorage.clear();
  });

  it("fresh authorization stores no capabilityToken in localStorage", async () => {
    const authResponse = {
      intentId: "intent-fresh-123",
      capabilityToken: "secret-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    // Override fetch to return proper responses
    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(authResponse),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // Start upload - this will trigger authorization
    const uploadPromise = sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    // Wait for authorization to complete
    await new Promise((r) => setTimeout(r, 100));

    // Check localStorage was called with data that does NOT contain capabilityToken
    const setItemCalls = (sandbox.localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls;
    expect(setItemCalls.length).toBeGreaterThan(0);

    const [, storedValue] = setItemCalls[0];
    const parsed = JSON.parse(storedValue);
    expect(parsed.capabilityToken).toBeUndefined();
    expect(storedValue).not.toContain("secret-cap-token");
    expect(parsed.intentId).toBe("intent-fresh-123");
  });

  it("finalize request includes the capabilityToken", async () => {
    const authResponse = {
      intentId: "intent-finalize-456",
      capabilityToken: "finalize-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    let finalizeResolve: (value: any) => void;
    const finalizePromise = new Promise((resolve) => { finalizeResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(authResponse),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/finalize") {
        finalizeResolve({ url, options });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    // Create a mock tus.Upload that immediately calls onSuccess
    let capturedOnSuccess: (() => void) | undefined;
    sandbox.tus.Upload = vi.fn().mockImplementation(function(file: any, options: any) {
      capturedOnSuccess = options.onSuccess;
      return {
        start: () => {
          // Immediately trigger success to test finalize
          if (options.onSuccess) {
            setTimeout(() => options.onSuccess(), 10);
          }
        },
        findPreviousUploads: () => Promise.resolve([]),
        abort: () => Promise.resolve(),
      };
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // Start upload
    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    // Wait for finalize
    const finalizeCall: any = await finalizePromise;

    // Verify finalize request includes capabilityToken
    const body = JSON.parse(finalizeCall.options.body);
    expect(body.capabilityToken).toBe("finalize-cap-token");
    expect(body.intentId).toBe("intent-finalize-456");
  });

  it("same-page resume includes the in-memory capabilityToken", async () => {
    const authResponse = {
      intentId: "intent-resume-789",
      capabilityToken: "resume-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    const resumeResponse = {
      intentId: "intent-resume-789",
      endpoint: "https://tus.example.com",
      token: "resumed-token",
      bucket: "test-bucket",
      path: "resumed/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    let resumeResolve: (value: any) => void;
    const resumePromise = new Promise((resolve) => { resumeResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(authResponse),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/resume") {
        resumeResolve({ url, options });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(resumeResponse),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: 1234567890 };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // First upload - authorizes and stores token in memory
    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);
    await new Promise((r) => setTimeout(r, 100));

    // Second upload - should trigger resume
    fetchCalls = [];
    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    const resumeCall: any = await resumePromise;
    const body = JSON.parse(resumeCall.options.body);
    expect(body.capabilityToken).toBe("resume-cap-token");
  });

  it("page refresh with cached auth but no memory token never calls /resume", async () => {
    const cachedAuth = {
      intentId: "cached-intent-refresh",
      storageEnabled: true,
      endpoint: "https://tus.example.com",
      token: "cached-token",
      bucket: "test-bucket",
      path: "cached/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    const freshAuth = {
      intentId: "fresh-intent-after-refresh",
      capabilityToken: "fresh-token",
      endpoint: "https://tus.example.com",
      token: "fresh-auth-token",
      bucket: "test-bucket",
      path: "fresh/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    // Pre-populate localStorage with cached auth
    const resumeKey = 'odm-storage-upload:["governance",[["facilitySlug","test-fac"],["milestoneId",123]],"test.pdf","application/pdf",1024,1234567890]';
    mockLocalStorage.set(resumeKey, JSON.stringify(cachedAuth));

    let authorizeResolve: (value: any) => void;
    const authorizePromise = new Promise((resolve) => { authorizeResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        authorizeResolve({ url, options });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(freshAuth),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: 1234567890 };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);

    await authorizePromise;

    // Should NOT call /resume
    const resumeCalls = fetchCalls.filter((c) => c.url === "/api/storage/uploads/resume");
    expect(resumeCalls.length).toBe(0);

    // Should call /authorize
    const authorizeCalls = fetchCalls.filter((c) => c.url === "/api/storage/uploads/authorize");
    expect(authorizeCalls.length).toBe(1);

    // Should clear the stale cache
    expect(mockLocalStorage.has(resumeKey)).toBe(false);
  });

  it("abandon includes the capabilityToken in request", async () => {
    const abortController = new AbortController();

    const authResponse = {
      intentId: "intent-abandon-abc",
      capabilityToken: "abandon-cap-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    let abandonResolve: (value: any) => void;
    const abandonPromise = new Promise((resolve) => { abandonResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(authResponse),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/abandon") {
        abandonResolve({ url, options });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // Start upload
    const uploadPromise = sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), abortController.signal);
    await new Promise((r) => setTimeout(r, 50));

    // Trigger abort
    fetchCalls = [];
    abortController.abort();

    const abandonCall: any = await abandonPromise;
    const body = JSON.parse(abandonCall.options.body);
    expect(body.capabilityToken).toBe("abandon-cap-token");
  });

  it("successful finalize clears the in-memory token", async () => {
    const authResponse = {
      intentId: "intent-cleanup-xyz",
      capabilityToken: "cleanup-token",
      endpoint: "https://tus.example.com",
      token: "auth-token",
      bucket: "test-bucket",
      path: "test/path",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      chunkSize: 6 * 1024 * 1024,
    };

    let finalizeResolve: (value: any) => void;
    const finalizePromise = new Promise((resolve) => { finalizeResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(authResponse),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/finalize") {
        finalizeResolve({ url, options });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    // Create mock tus.Upload that triggers onSuccess
    sandbox.tus.Upload = vi.fn().mockImplementation(function(file: any, options: any) {
      return {
        start: () => {
          setTimeout(() => {
            if (options.onSuccess) options.onSuccess();
          }, 10);
        },
        findPreviousUploads: () => Promise.resolve([]),
        abort: () => Promise.resolve(),
      };
    });

    const file = { name: "test.pdf", type: "application/pdf", size: 1024, lastModified: Date.now() };
    const target = { facilitySlug: "test-fac", milestoneId: 123 };

    // First upload - complete with finalize
    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);
    await finalizePromise;

    // Reset and check second upload - should NOT resume (token cleared)
    fetchCalls = [];
    let authorizeResolve: (value: any) => void;
    const authorizePromise = new Promise((resolve) => { authorizeResolve = resolve; });

    mockFetch.mockImplementation((url: string, options: any) => {
      fetchCalls.push({ url, options });
      if (url === "/api/storage/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ flags: { global: true, governance: true } }),
          status: 200,
        });
      }
      if (url === "/api/storage/uploads/authorize") {
        authorizeResolve({ url, options });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...authResponse, intentId: "new-intent" }),
          status: 200,
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), status: 200 });
    });

    sandbox.uploadGovernanceFileWithRollback(file, target, vi.fn(), vi.fn(), null);
    await authorizePromise;

    // Should call /authorize, not /resume
    const resumeCalls = fetchCalls.filter((c) => c.url === "/api/storage/uploads/resume");
    expect(resumeCalls.length).toBe(0);
  });
});
