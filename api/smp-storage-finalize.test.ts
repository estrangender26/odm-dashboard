import { describe, it, expect, vi, beforeEach } from "vitest";
import { smpDocuments, smpDocumentRevisions, storageUploadIntents } from "@db/schema";

/**
 * Focused test of the governed SMP upload finalize branch:
 *   - an upload against an existing series creates an immutable REVISION row,
 *     supersedes the previous current revision, and mirrors the series row;
 *   - a NEW document upload creates the series and its first revision
 *     ATOMICALLY at finalize, so a failed upload leaves no orphan series and
 *     the same reference number can be retried successfully;
 *   - duplicate revision labels are rejected (no silent overwrite).
 */

const mocks = vi.hoisted(() => ({
  intentById: null as any,
  existingRevisions: [] as any[],
  existingDocuments: [] as any[],
  insertReturning: [{ id: 1 }] as any[],
  insertValues: [] as any[],
  updateSets: [] as any[],
  updateTables: [] as any[],
  updateReturning: [] as any[],
  smpUpdateReturning: [] as any[],
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
          from: vi.fn((table: any) => ({
            where: vi.fn(() => {
              const result = () =>
                table === smpDocuments ? mocks.existingDocuments : mocks.existingRevisions;
              const chain: any = {
                limit: vi.fn(async () => result()),
                then: (resolve: (value: any) => void) => resolve(result()),
              };
              return chain;
            }),
          })),
        })),
        update: vi.fn((table: any) => {
          mocks.updateTables.push(table);
          return {
            set: vi.fn((values: any) => {
              mocks.updateSets.push(values);
              return {
                where: vi.fn(() => ({
                  returning: vi.fn(async () =>
                    table === storageUploadIntents ? mocks.updateReturning : mocks.smpUpdateReturning,
                  ),
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

function stubStorageSuccess(intent: any) {
  mocks.infoResult = {
    bucketId: intent.expectedBucket,
    name: intent.expectedPath,
    size: intent.expectedSize,
    contentType: "application/pdf",
    etag: "etag-1",
  };
  mocks.storageFrom.mockReturnValue({
    info: vi.fn(async () => ({ data: mocks.infoResult, error: null })),
  });
}

function stubStorageFailure() {
  mocks.storageFrom.mockReturnValue({
    info: vi.fn(async () => ({ data: null, error: new Error("object not found") })),
  });
}

const seriesInserts = () => mocks.insertValues.filter((v: any) => v.code !== undefined);
const revisionInserts = () => mocks.insertValues.filter((v: any) => v.revision !== undefined && v.documentId !== undefined);

describe("SMP storage finalize — revision governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingRevisions = [];
    mocks.existingDocuments = [];
    mocks.insertValues = [];
    mocks.updateSets = [];
    mocks.updateTables = [];
    mocks.insertReturning = [{ id: 1 }];
    // Claim update (intent status transition) must return a row.
    mocks.updateReturning = [{ id: "claim-ok" }];
    // No previous current revision by default (supersede returns no rows).
    mocks.smpUpdateReturning = [];
  });

  it("creates an immutable current revision row for an existing-series upload", async () => {
    const { intent, token } = buildSmpIntentAndToken();
    stubStorageSuccess(intent);
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, fileId: 1, source: "smp_document_revisions" });

    const revision = revisionInserts()[0];
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
    expect(seriesInserts()).toHaveLength(0);
  });

  it("supersedes the previous current revision and mirrors the new one onto the series row", async () => {
    const { intent, token } = buildSmpIntentAndToken();
    stubStorageSuccess(intent);
    mocks.intentById = intent;
    mocks.existingRevisions = [
      { id: 7, revision: "Rev. 0", status: "current" },
      { id: 8, revision: "Rev. 1", status: "superseded" },
    ];
    // The previous current revision (id 7) is captured by the pre-insert
    // supersede; the backfill then points it at the new revision.
    mocks.smpUpdateReturning = [{ id: 7 }];

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);

    // The pre-insert supersede carries no pointer yet (the new id does not
    // exist at that point) — and crucially the predicate runs BEFORE the new
    // revision exists, so the new revision can never supersede itself.
    const supersedeSet = mocks.updateSets.find((s: any) => s.status === "superseded");
    expect(supersedeSet).toMatchObject({ status: "superseded", supersededByRevisionId: null });

    // The backfill points the previous current revision at the new revision.
    const backfillSet = mocks.updateSets.find((s: any) => s.supersededByRevisionId === 1);
    expect(backfillSet).toBeDefined();

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
    stubStorageSuccess(intent);
    mocks.intentById = intent;
    mocks.existingRevisions = [{ id: 7, revision: "Rev. 2", status: "current" }];

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("already exists");
    expect(revisionInserts()).toHaveLength(0);
  });

  it("defaults to the baseline revision label when none is provided", async () => {
    const { intent, token } = buildSmpIntentAndToken({
      target: { documentId: 3 },
      expectedPath: "v1/document-3/x",
    });
    stubStorageSuccess(intent);
    mocks.intentById = intent;

    const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
    expect(res.status).toBe(200);
    expect(revisionInserts()[0].revision).toBe("Rev. 0");
    expect(revisionInserts()[0].revisionNumber).toBe(0);
    expect(revisionInserts()[0].effectivityDate).toBeNull();
  });

  describe("new-document uploads (no orphan series)", () => {
    function newDocIntent(overrides: any = {}) {
      return buildSmpIntentAndToken({
        target: {
          code: "MW-ENGG-SP-1.0",
          title: "Centrifugal Pump System",
          smpFamily: "Centrifugal Pump System",
          revision: "Rev. 0",
          effectivityDate: "2026-03-16",
        },
        expectedPath: "v1/smp-new/x",
        ...overrides,
      });
    }

    it("creates the series and first revision atomically on successful finalize", async () => {
      const { intent, token } = newDocIntent();
      stubStorageSuccess(intent);
      mocks.intentById = intent;

      const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; source: string; documentId?: number };
      expect(body).toMatchObject({ success: true, source: "smp_document_revisions" });
      expect(body.documentId).toBe(1);

      const series = seriesInserts();
      expect(series).toHaveLength(1);
      expect(series[0]).toMatchObject({
        code: "MW-ENGG-SP-1.0",
        codeKey: "mw-engg-sp-1.0",
        title: "Centrifugal Pump System",
        smpFamily: "Centrifugal Pump System",
        status: "Active",
      });
      expect(revisionInserts()).toHaveLength(1);
      expect(revisionInserts()[0]).toMatchObject({
        documentId: 1,
        revision: "Rev. 0",
        status: "current",
      });
    });

    it("leaves no orphan series behind when the initial upload finalize fails", async () => {
      const { intent, token } = newDocIntent();
      stubStorageFailure();
      mocks.intentById = intent;

      const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
      expect(res.status).toBe(400);

      // Neither the document series nor a revision row was inserted.
      expect(seriesInserts()).toHaveLength(0);
      expect(revisionInserts()).toHaveLength(0);
      expect(mocks.insertValues).toHaveLength(0);
    });

    it("retries the same reference number successfully after a failed initial upload", async () => {
      const { intent, token } = newDocIntent();

      // Attempt 1: upload/finalize fails (storage object missing).
      stubStorageFailure();
      mocks.intentById = intent;
      const failed = await storageRouter.request(makeFinalizeRequest(intent.id, token));
      expect(failed.status).toBe(400);
      expect(seriesInserts()).toHaveLength(0);

      // Attempt 2: the SAME reference number can be retried successfully.
      stubStorageSuccess(intent);
      const retried = await storageRouter.request(makeFinalizeRequest(intent.id, token));
      expect(retried.status).toBe(200);
      expect(seriesInserts()).toHaveLength(1);
      expect(seriesInserts()[0].code).toBe("MW-ENGG-SP-1.0");
      expect(revisionInserts()).toHaveLength(1);
    });

    it("rejects a duplicate reference number at finalize (database identity guarantee)", async () => {
      const { intent, token } = newDocIntent();
      stubStorageSuccess(intent);
      mocks.intentById = intent;
      // Simulate the unique identity already being present (race window or
      // concurrent upload): the duplicate pre-check must reject before any
      // insert, matching the database unique index behavior.
      mocks.existingDocuments = [{ id: 99 }];

      const res = await storageRouter.request(makeFinalizeRequest(intent.id, token));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain("already exists");
      expect(seriesInserts()).toHaveLength(0);
    });
  });
});
