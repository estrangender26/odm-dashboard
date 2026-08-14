import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  intentById: null as any,
  updateReturning: [] as any[],
  infoResult: null as any,
  storageFrom: vi.fn(),
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret-for-unit-tests-only");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

vi.mock("./queries/connection", () => ({
  db: {
    query: {
      storageUploadIntents: {
        findFirst: vi.fn(async () => mocks.intentById),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.updateReturning),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async () => {}),
    })),
    transaction: vi.fn(async (fn: any) => fn({
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => mocks.updateReturning),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async () => [{ id: 1 }]),
      })),
    })),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => ({
    storage: {
      from: mocks.storageFrom,
    },
  })),
  getSupabaseStorageConfig: vi.fn(() => ({
    url: "https://project-ref.supabase.co",
    directStorageUrl: "https://project-ref.storage.supabase.co",
    serviceRoleKey: "test-key",
  })),
}));

vi.mock("./lib/env", () => ({
  env: {
    supabaseUrl: "https://project-ref.supabase.co",
    supabaseServiceRoleKey: "test-key",
    appId: "test-app",
    appSecret: "test-secret-for-unit-tests-only",
  },
}));

vi.mock("./kimi/auth", () => ({
  authenticateRequest: vi.fn(() => Promise.reject(new Error("No auth"))),
}));

import { storageRouter } from "./storage-router";
import { generateCapabilityClaims, signCapabilityClaims } from "./upload-capability";

function hashToken(token: string) {
  const { createHmac } = require("node:crypto");
  return createHmac("sha256", "test-secret-for-unit-tests-only" + ":capability-hash")
    .update(token)
    .digest("hex");
}

function buildIntentAndToken(overrides: any = {}): { intent: any; token: string } {
  const id = overrides.id || "11111111-1111-4111-8111-111111111111";
  const module = overrides.module || "om";
  const source = overrides.source || "doc_files";
  const target = overrides.target || { folderId: 1 };
  const expectedPath = overrides.expectedPath || `v1/folder-1/${id}`;
  const expectedBucket = overrides.expectedBucket || "om-manuals";
  const originalFilename = overrides.originalFilename || "manual.pdf";
  const expectedMimeType = overrides.expectedMimeType || "application/pdf";
  const expectedSize = overrides.expectedSize || 1024;

  const claims = generateCapabilityClaims(
    id,
    module,
    source,
    target,
    expectedPath,
    expectedBucket,
    originalFilename,
    expectedMimeType,
    expectedSize,
  );
  const token = signCapabilityClaims(claims);

  const intent = {
    id,
    module,
    targetContext: target,
    expectedBucket,
    expectedPath,
    originalFilename,
    expectedSize,
    expectedMimeType,
    requestedBy: null,
    capabilityJti: claims.jti,
    capabilityExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    capabilityConsumedAt: null,
    status: overrides.status || "pending",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
    capabilityTokenHash: hashToken(token),
  };

  return { intent, token };
}

function makeFinalizeRequest(intentId: string, token?: string) {
  const body: any = { intentId };
  if (token) body.capabilityToken = token;
  return new Request("http://localhost/uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeResumeRequest(intentId: string, token?: string) {
  const body: any = { intentId };
  if (token) body.capabilityToken = token;
  return new Request("http://localhost/uploads/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("finalize and capability security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageFrom.mockReturnValue({
      info: vi.fn(async () => ({
        data: mocks.infoResult,
        error: null,
      })),
    });
    mocks.intentById = null;
    mocks.updateReturning = [];
  });

  it("rejects finalize with mismatched module claim", async () => {
    const { intent } = buildIntentAndToken({ id: "11111111-1111-4111-8111-111111111111" });
    const badClaims = generateCapabilityClaims(
      intent.id,
      "smp", // wrong module
      "doc_files",
      intent.targetContext,
      intent.expectedPath,
      intent.expectedBucket,
      intent.originalFilename,
      intent.expectedMimeType,
      intent.expectedSize,
    );
    const badToken = signCapabilityClaims(badClaims);
    intent.capabilityTokenHash = hashToken(badToken);
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, badToken));
    expect(res.status).toBe(403);
  });

  it("rejects finalize with mismatched source claim", async () => {
    const { intent } = buildIntentAndToken({ id: "22222222-2222-4212-8222-222222222222" });
    const badClaims = generateCapabilityClaims(
      intent.id,
      intent.module,
      "smp_documents", // wrong source
      intent.targetContext,
      intent.expectedPath,
      intent.expectedBucket,
      intent.originalFilename,
      intent.expectedMimeType,
      intent.expectedSize,
    );
    const badToken = signCapabilityClaims(badClaims);
    intent.capabilityTokenHash = hashToken(badToken);
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, badToken));
    expect(res.status).toBe(403);
  });

  it("rejects finalize with mismatched target", async () => {
    const { intent } = buildIntentAndToken({ id: "33333333-3333-4313-8333-333333333333" });
    const badClaims = generateCapabilityClaims(
      intent.id,
      intent.module,
      "doc_files",
      { folderId: 999 }, // wrong target
      intent.expectedPath,
      intent.expectedBucket,
      intent.originalFilename,
      intent.expectedMimeType,
      intent.expectedSize,
    );
    const badToken = signCapabilityClaims(badClaims);
    intent.capabilityTokenHash = hashToken(badToken);
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, badToken));
    expect(res.status).toBe(403);
  });

  it("rejects finalize with mismatched jti", async () => {
    const { intent, token } = buildIntentAndToken({ id: "77777777-7777-4717-8777-777777777777" });
    const wrongClaims = generateCapabilityClaims(
      intent.id,
      intent.module,
      "doc_files",
      intent.targetContext,
      intent.expectedPath,
      intent.expectedBucket,
      intent.originalFilename,
      intent.expectedMimeType,
      intent.expectedSize,
    );
    const wrongToken = signCapabilityClaims(wrongClaims); // different jti
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, wrongToken));
    expect(res.status).toBe(403);
  });

  it("rejects resume with expired capability", async () => {
    const expiredClaims = generateCapabilityClaims(
      "44444444-4444-4414-8444-444444444444",
      "om",
      "doc_files",
      { folderId: 1 },
      "v1/folder-1/intent-4",
      "om-manuals",
      "manual.pdf",
      "application/pdf",
      1024,
    );
    expiredClaims.exp = Math.floor(Date.now() / 1000) - 1;
    const expiredToken = signCapabilityClaims(expiredClaims);
    const { intent } = buildIntentAndToken({
      id: "44444444-4444-4414-8444-444444444444",
      capabilityJti: expiredClaims.jti,
      capabilityTokenHash: hashToken(expiredToken),
    });
    mocks.intentById = intent;

    const res = await storageRouter.request(makeResumeRequest(intent.id, expiredToken));
    expect(res.status).toBe(403);
  });

  it("anonymous resume requires capability token", async () => {
    const { intent } = buildIntentAndToken({ id: "55555555-5555-4515-8555-555555555555" });
    mocks.intentById = intent;

    const res = await storageRouter.request(makeResumeRequest(intent.id));
    expect(res.status).toBe(401);
  });

  it("returns already-finalized on repeated finalize after success", async () => {
    const { intent, token } = buildIntentAndToken({ id: "66666666-6666-4616-8666-666666666666", status: "finalized" });
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, alreadyFinalized: true });
  });
});
