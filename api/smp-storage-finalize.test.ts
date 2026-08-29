import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Focused test of the governed SMP upload finalize branch: a finalized
 * storage intent must create an immutable REVISION row, supersede the
 * previous current revision, mirror the new current revision onto the
 * document series row, and reject duplicate revision labels.
 */

const mocks = vi.hoisted(() => ({
  intentById: null as any,
  existingRevisions: [] as any[],
  insertReturning: [{ id: 1 }] as any[],
  insertValues: [] as any[],
  updateSets: [] as any[],
  updateTables: [] as any[],
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
    transaction: vi.fn(async (fn: any) =>
      fn({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => mocks.existingRevisions),
          })),
        })),
        update: vi.fn((table: any) => {
          mocks.updateTables.push(table);
          return {
            set: vi.fn((values: any) => {
              mocks.updateSets.push(values);
              return {
                where: vi.fn(() => ({
                  returning: vi.fn(async () => mocks.updateReturning),
                })),
              };
            }),
          };
        }),
        insert: vi.fn(() => ({
          values: vi.fn((values: any) => {
            mocks.insertValues.push(values);
            return { returning: vi.fn(async () => mocks.insertReturning) };
          }),
        })),
      }),
    ),
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

vi.mock("./auth/authenticate", () => ({
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

function buildSmpIntentAndToken(overrides: any = {}) {
  const id = overrides.id || "99999999-9999-4999-8999-999999999999";
  const module = "smp";
  const source = "smp_document_revisions";
  const target = overrides.target || {
    documentId: 3,
    revision: "Rev. 2",
    effectivityDate: "2026-03-16",
  };
  const expectedPath = overrides.expectedPath || `v1/document-3/${id}`;
  const expectedBucket = "smp-library";
  const originalFilename = overrides.originalFilename || "MW-ENGG-SP-1.0.pdf";
  const expectedMimeType = "application/pdf";
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
    status: "pending",
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

describe("SMP storage finalize — revision governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingRevisions = [];
    mocks.insertValues = [];
    mocks.updateSets = [];
    mocks.updateTables = [];
    mocks.insertReturning = [{ id: 1 }];
    // Claim update (intent status transition) must return a row.
    mocks.updateReturning = [{ id: "claim-ok" }];
    mocks.storageFrom.mockReturnValue({
      info: vi.fn(async () => ({
        data: mocks.infoResult,
        error: null,
      })),
    });
    mocks.infoResult = {
      bucketId: "smp-library",
      name: "v1/document-3/x",
      size: 1024,
      contentType: "application/pdf",
      etag: "etag-1",
    };
  });

  it("creates an immutable current revision row for the upload", async () => {
    const { intent, token } = buildSmpIntentAndToken();
    mocks.infoResult.name = intent.expectedPath;
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, fileId: 1, source: "smp_document_revisions" });

    expect(mocks.insertValues).toHaveLength(1);
    const revision = mocks.insertValues[0];
    expect(revision).toMatchObject({
      documentId: 3,
      revision: "Rev. 2",
      revisionNumber: 2,
      status: "current",
      effectivityDate: "2026-03-16",
      originalFileName: "MW-ENGG-SP-1.0.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      storageProvider: "supabase",
      storageBucket: "smp-library",
      storagePath: intent.expectedPath,
    });
  });

  it("supersedes the previous current revision and mirrors the new one onto the series row", async () => {
    const { intent, token } = buildSmpIntentAndToken();
    mocks.infoResult.name = intent.expectedPath;
    mocks.intentById = intent;
    mocks.existingRevisions = [
      { id: 7, revision: "Rev. 0", status: "current" },
      { id: 8, revision: "Rev. 1", status: "superseded" },
    ];

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);

    // The previous current revision (Rev. 0) is marked superseded and points
    // at the new revision — it is never deleted.
    const supersedeSet = mocks.updateSets.find((s: any) => s.status === "superseded");
    expect(supersedeSet).toMatchObject({ status: "superseded", supersededByRevisionId: 1 });

    // The series row mirrors the new current revision.
    const mirrorSet = mocks.updateSets.find((s: any) => s.revision === "Rev. 2");
    expect(mirrorSet).toMatchObject({
      revision: "Rev. 2",
      fileName: "MW-ENGG-SP-1.0.pdf",
      status: "Active",
      storagePath: intent.expectedPath,
    });
  });

  it("rejects a duplicate revision label instead of overwriting history", async () => {
    const { intent, token } = buildSmpIntentAndToken();
    mocks.infoResult.name = intent.expectedPath;
    mocks.intentById = intent;
    mocks.existingRevisions = [{ id: 7, revision: "Rev. 2", status: "current" }];

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("already exists");
    expect(mocks.insertValues).toHaveLength(0);
  });

  it("defaults to the baseline revision label when none is provided", async () => {
    const { intent, token } = buildSmpIntentAndToken({
      target: { documentId: 3 },
    });
    mocks.infoResult.name = intent.expectedPath;
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);
    expect(mocks.insertValues[0].revision).toBe("Rev. 0");
    expect(mocks.insertValues[0].revisionNumber).toBe(0);
    expect(mocks.insertValues[0].effectivityDate).toBeNull();
  });
});
