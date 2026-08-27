import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Projects without PPP — PUBLIC (anonymous) masterdata upload security
// Uses the repository's existing capability-token storage architecture:
//   authorize (anonymous) -> capability bound to ONE project+intent
//   finalize -> persisted evidence ONLY after verification
// No login required; no users-table row; neutral submitter label persisted.
// ============================================================================

const mocks = vi.hoisted(() => ({
  intentById: null as any,
  projectRows: [] as any[],
  insertedIntentValues: null as any,
  claimedReturning: [] as any[],
  insertedFile: [] as any[],
  insertedFileValues: null as any,
  infoResult: null as any,
  signedUploadToken: "signed-upload-token",
  rateLimitResult: [] as any[],
  storageFrom: vi.fn(),
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret-for-unit-tests-only");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_STORAGE_UPLOADS_ENABLED", "true");
vi.stubEnv("SUPABASE_STORAGE_PROJECTS_WITHOUT_PPP_ENABLED", "true");

const selectChain = () => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(async () => mocks.projectRows),
    })),
  })),
});

vi.mock("./queries/connection", () => ({
  db: {
    query: {
      storageUploadIntents: {
        findFirst: vi.fn(async () => mocks.intentById),
      },
    },
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: any) => {
        mocks.insertedIntentValues = values;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.claimedReturning),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: any) =>
      fn({
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => mocks.claimedReturning),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((values: any) => {
            mocks.insertedFileValues = values;
            return { returning: vi.fn(async () => mocks.insertedFile) };
          }),
        })),
      }),
    ),
    execute: vi.fn(async () => mocks.rateLimitResult),
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
  authenticateRequest: vi.fn(() => Promise.reject(new Error("No auth"))), // anonymous caller
}));

import { storageRouter } from "./storage-router";
import { projectsWithoutPPPRouter } from "./projects-without-ppp-router";
import { generateCapabilityClaims, signCapabilityClaims, hashCapabilityToken } from "./upload-capability";
import { deriveProjectSubmissionStatus } from "./projects-without-ppp-status";

function buildIntentAndToken(overrides: any = {}): { intent: any; token: string } {
  const id = overrides.id || "11111111-1111-4111-8111-111111111111";
  const module = "projects_without_ppp";
  const source = "project_without_ppp_files";
  const target = overrides.target || { projectId: 1 };
  const expectedPath = overrides.expectedPath || `v1/project-${target.projectId}/${id}`;
  const expectedBucket = "projects-without-ppp";
  const originalFilename = overrides.originalFilename || "masterdata.xlsx";
  const expectedMimeType = overrides.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const expectedSize = overrides.size ?? 1024;

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
    status: "pending",
    requestedBy: null, // anonymous public upload
    targetContext: target,
    expectedBucket,
    expectedPath,
    originalFilename,
    expectedMimeType,
    expectedSize,
    capabilityJti: claims.jti,
    capabilityTokenHash: hashCapabilityToken(token),
    capabilityExpiresAt: new Date(Date.now() + 60_000),
    capabilityConsumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides.intent,
  };

  return { intent, token };
}

type AuthorizeBody = {
  storageEnabled?: boolean;
  error?: string;
  bucket?: string;
  intentId?: string;
  capabilityToken?: string;
};

async function readJson(response: Response): Promise<AuthorizeBody | { error: string } | { success: boolean; fileId: number; source: string }> {
  return (await response.json()) as any;
}

async function authorize(overrides: any = {}) {
  const req = new Request("http://localhost/uploads/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      module: "projects_without_ppp",
      originalFilename: overrides.originalFilename ?? "masterdata.xlsx",
      mimeType: overrides.mimeType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileSize: overrides.fileSize ?? 1024,
      target: overrides.target ?? { projectId: 1 },
    }),
  });
  return storageRouter.request(req);
}

describe("projects_without_ppp PUBLIC (anonymous) upload security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.intentById = null;
    mocks.projectRows = [{ id: 1 }];
    mocks.insertedIntentValues = null;
    mocks.insertedFileValues = null;
    mocks.insertedFile = [{ id: 5 }];
    mocks.claimedReturning = [{ id: "11111111-1111-4111-8111-111111111111" }];
    mocks.rateLimitResult = [{ intent_count: 1, total_bytes: 1024 }];
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({
      createSignedUploadUrl: vi.fn(async () => ({
        data: { token: mocks.signedUploadToken },
        error: null,
      })),
      info: vi.fn(async () => mocks.infoResult),
    });
    mocks.infoResult = {
      data: {
        size: 1024,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        etag: "etag-1",
        bucketId: "projects-without-ppp",
        name: "v1/project-1/11111111-1111-4111-8111-111111111111",
      },
      error: null,
    };
  });

  it("anonymous authorize succeeds for a valid project and returns a capability token", async () => {
    const response = await authorize();
    expect(response.status).toBe(200);
    const body = await readJson(response) as AuthorizeBody;
    expect(body.storageEnabled).toBe(true);
    expect(body.bucket).toBe("projects-without-ppp");
    expect(body.intentId).toBeTruthy();
    expect(body.capabilityToken).toBeTruthy(); // anonymous capability minted
    // Intent is bound to the project and records no users-table identity.
    expect(mocks.insertedIntentValues.requestedBy).toBeNull();
    expect(mocks.insertedIntentValues.targetContext).toEqual({ projectId: 1 });
  });

  it("anonymous authorize fails for a nonexistent project", async () => {
    mocks.projectRows = [];
    const response = await authorize();
    expect(response.status).toBe(400);
    const body = await readJson(response) as AuthorizeBody;
    expect(body.error).toMatch(/Project not found/i);
  });

  it("anonymous capability is bound to exactly one project (project 2 token cannot finalize project 1)", async () => {
    const { intent, token } = buildIntentAndToken({ target: { projectId: 1 } });
    const wrongProjectToken = signCapabilityClaims(
      generateCapabilityClaims(
        intent.id,
        "projects_without_ppp",
        "project_without_ppp_files",
        { projectId: 2 }, // different project
        intent.expectedPath,
        intent.expectedBucket,
        intent.originalFilename,
        intent.expectedMimeType,
        intent.expectedSize,
      ),
    );
    mocks.intentById = intent;

    const response = await storageRouter.request(
      new Request("http://localhost/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intent.id, capabilityToken: wrongProjectToken }),
      }),
    );
    expect(response.status).toBe(403);
    const body = await readJson(response) as { error: string };
    expect(body.error).toMatch(/Invalid capability token/i);
    expect(mocks.insertedFileValues).toBeNull(); // nothing persisted
  });

  it("finalize cannot switch project ids — evidence persists to the intent-bound project", async () => {
    const { intent, token } = buildIntentAndToken({ target: { projectId: 1 } });
    mocks.intentById = intent;

    const response = await storageRouter.request(
      new Request("http://localhost/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intent.id, capabilityToken: token }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; fileId: number; source: string; deleteCapability?: string };
    expect(body).toMatchObject({ success: true, fileId: 5, source: "project_without_ppp_files" });
    // The uploader's own finalize response carries the governed delete
    // capability bound to this file (never exposed in dashboard responses).
    expect(body.deleteCapability).toBeTruthy();
    // The persisted row uses the intent's targetContext projectId; the caller
    // has no way to supply a project id at finalize time.
    expect(Number(mocks.insertedFileValues.projectId)).toBe(1);
    expect(mocks.insertedFileValues.storageBucket).toBe("projects-without-ppp");
    expect(mocks.insertedFileValues.fileName).toBe("masterdata.xlsx");
    expect(mocks.insertedFileValues.fileData).toBeNull();
  });

  it("public finalized evidence persists a neutral submitter label", async () => {
    const { intent, token } = buildIntentAndToken();
    mocks.intentById = intent;

    const response = await storageRouter.request(
      new Request("http://localhost/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intent.id, capabilityToken: token }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.insertedFileValues.uploadedBy).toBe("Public Project Submission");
  });

  it("anonymous project create/update/delete remain unavailable on the router", () => {
    const procedures = Object.keys(projectsWithoutPPPRouter);
    expect(procedures).not.toContain("create");
    expect(procedures).not.toContain("update");
    expect(procedures).not.toContain("delete");
  });

  it("anonymous file delete remains rejected for project_without_ppp_files", async () => {
    const response = await storageRouter.request(
      new Request("http://localhost/files/delete/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "project_without_ppp_files", id: 1 }),
      }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/cannot be deleted through the public endpoint/i);
  });

  it("invalid extensions are rejected for anonymous authorize", async () => {
    const response = await authorize({ originalFilename: "evil.exe", mimeType: "application/octet-stream" });
    expect(response.status).toBe(400);
    const body = await readJson(response) as AuthorizeBody;
    expect(body.error).toMatch(/File extension is not allowed/i);
  });

  it("MIME mismatch is rejected for anonymous authorize", async () => {
    const response = await authorize({
      originalFilename: "masterdata.pdf",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(response.status).toBe(400);
    const body = await readJson(response) as AuthorizeBody;
    expect(body.error).toMatch(/MIME type does not match its extension/i);
  });

  it("exactly 150 MB is accepted; 150 MB + 1 byte is rejected", async () => {
    const ok = await authorize({ fileSize: 157_286_400 });
    expect(ok.status).toBe(200);

    const tooBig = await authorize({ fileSize: 157_286_401 });
    expect(tooBig.status).toBe(413);
    const body = await readJson(tooBig) as AuthorizeBody;
    expect(body.error).toMatch(/150 MB/);
  });

  it("an incomplete/unfinalized upload never persists evidence or changes status", async () => {
    const before = await authorize();
    expect(before.status).toBe(200);
    // Authorize only creates an upload intent; no submission-file row exists.
    expect(mocks.insertedFileValues).toBeNull();
    expect(deriveProjectSubmissionStatus(0)).toBe("not_submitted");
  });
});
