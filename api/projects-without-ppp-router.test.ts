import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  MAX_BASE64_UPLOAD_LENGTH,
  getDecodedBase64ByteLengthFromEncoding,
  isBase64UploadSizeAllowed,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";

// ============================================================================
// BEHAVIORAL TESTS: Projects without PPP attachment fallback
// Legacy (non-storage) attachments must persist their contents in file_data so
// they stay retrievable; storage-backed records must keep file_data NULL;
// oversized fallback content must be rejected; authentication must not weaken.
// ============================================================================

const mocks = vi.hoisted(() => ({
  dbInsertValues: [] as { table: unknown; values: Record<string, unknown> }[],
  dbSelectResult: [] as unknown[],
}));

// Mock the database connection before importing the router / storage helpers
vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mocks.dbSelectResult)),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        mocks.dbInsertValues.push({ table, values });
        return {
          returning: vi.fn(() => Promise.resolve([{ id: 99 }])),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve({})),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({})),
      })),
    })),
    execute: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ column: a, value: b })),
  and: vi.fn((...args: unknown[]) => ({ conditions: args })),
  sql: Object.assign(
    vi.fn((template: unknown, ...values: unknown[]) => ({ template, values })),
    { raw: vi.fn((str: string) => ({ raw: str })) }
  ),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

// Import routers and helpers after mocks
import { createRouter } from "./middleware";
import { projectsWithoutPPPRouter } from "./projects-without-ppp-router";
import { getStoredFileRecord } from "./storage-files";

const testRouter = createRouter({ projectsWithoutPPP: projectsWithoutPPPRouter });

const testUser = {
  id: 1,
  name: "Test User",
  email: "test@example.com",
  role: "user",
  avatar: null,
  unionId: null,
  createdAt: null,
  lastSignInAt: null,
};

const createUnauthCtx = () => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: undefined,
});

const createAuthCtx = () => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: testUser,
});

const SMALL_BASE64 = Buffer.from("dummy-pdf-content").toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbInsertValues = [];
  mocks.dbSelectResult = [];
});

describe("projectsWithoutPPP.attachFileRecord", () => {
  it("persists base64 fileData for legacy (non-storage) fallback attachments", async () => {
    const caller = testRouter.createCaller(createAuthCtx());
    const result = await caller.projectsWithoutPPP.attachFileRecord({
      projectId: 7,
      fileName: "contract.pdf",
      fileType: "application/pdf",
      fileSize: 19,
      fileData: SMALL_BASE64,
    });

    expect(result).toEqual({ id: 99 });
    expect(mocks.dbInsertValues).toHaveLength(1);
    const { values } = mocks.dbInsertValues[0];
    expect(values.projectId).toBe(7);
    expect(values.fileName).toBe("contract.pdf");
    expect(values.fileType).toBe("application/pdf");
    expect(values.fileSize).toBe(19);
    expect(values.fileData).toBe(SMALL_BASE64);
    expect(values.uploadedBy).toBe("Test User");
    expect(values.storageBucket).toBeNull();
    expect(values.storagePath).toBeNull();
    expect(values.storageProvider).toBeNull();
    expect(values.storageUploadedAt).toBeNull();
  });

  it("keeps file_data NULL for storage-backed records even when fileData is supplied", async () => {
    const caller = testRouter.createCaller(createAuthCtx());
    const result = await caller.projectsWithoutPPP.attachFileRecord({
      projectId: 7,
      fileName: "a.pdf",
      fileType: "application/pdf",
      fileSize: 100,
      fileData: SMALL_BASE64,
      storageBucket: "projects-without-ppp",
      storagePath: "v1/project-7/abc-123",
      storageMimeType: "application/pdf",
      storageSize: 100,
      storageEtag: "etag-1",
    });

    expect(result).toEqual({ id: 99 });
    expect(mocks.dbInsertValues).toHaveLength(1);
    const { values } = mocks.dbInsertValues[0];
    expect(values.fileData).toBeNull();
    expect(values.storageProvider).toBe("supabase");
    expect(values.storageBucket).toBe("projects-without-ppp");
    expect(values.storagePath).toBe("v1/project-7/abc-123");
    expect(values.storageEtag).toBe("etag-1");
  });

  it("rejects unauthenticated callers (authentication is not weakened)", async () => {
    const caller = testRouter.createCaller(createUnauthCtx());
    await expect(
      caller.projectsWithoutPPP.attachFileRecord({
        projectId: 1,
        fileName: "a.txt",
        fileData: SMALL_BASE64,
      })
    ).rejects.toThrow(
      new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" })
    );
    expect(mocks.dbInsertValues).toHaveLength(0);
  });

  it("rejects oversized fallback content at the router input boundary", async () => {
    const caller = testRouter.createCaller(createAuthCtx());
    // Smallest base64 payload whose decoded size exceeds the 150 MB limit:
    // ceil(150 MiB / 3) * 4 encoded chars decode to exactly 150 MiB; the next
    // 4-char block pushes the decoded size over the limit.
    const oversized = "A".repeat(MAX_BASE64_UPLOAD_LENGTH + 4);
    try {
      await caller.projectsWithoutPPP.attachFileRecord({
        projectId: 1,
        fileName: "big.bin",
        fileData: oversized,
      });
      expect.unreachable("oversized payload should have been rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const cause = (error as { cause?: unknown }).cause as
        | { issues?: unknown[] }
        | undefined;
      const message = error instanceof Error ? error.message : String(error);
      expect(message + JSON.stringify(cause?.issues ?? [])).toContain(
        "Maximum file size is 150 MB."
      );
    }
    expect(mocks.dbInsertValues).toHaveLength(0);
  });

  it("uses the repository size guard boundary: at-limit allowed, over-limit rejected", () => {
    const atLimit = getDecodedBase64ByteLengthFromEncoding(MAX_BASE64_UPLOAD_LENGTH, 0);
    const overLimit = getDecodedBase64ByteLengthFromEncoding(MAX_BASE64_UPLOAD_LENGTH + 4, 0);
    expect(atLimit).not.toBeNull();
    expect(overLimit).not.toBeNull();
    expect(isUploadFileSizeAllowed(atLimit as number)).toBe(true);
    expect(isUploadFileSizeAllowed(overLimit as number)).toBe(false);
    // A small valid payload passes the wired predicate used by the router.
    expect(isBase64UploadSizeAllowed(SMALL_BASE64)).toBe(true);
  });
});

describe("getStoredFileRecord (project_without_ppp_files)", () => {
  it("surfaces legacy file_data so fallback attachments remain retrievable", async () => {
    mocks.dbSelectResult = [
      {
        id: 5,
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        legacyData: SMALL_BASE64,
        storageBucket: null,
        storagePath: null,
        storageSize: null,
        storageMimeType: null,
      },
    ];

    const record = await getStoredFileRecord("project_without_ppp_files", 5);
    expect(record).not.toBeNull();
    expect(record!.source).toBe("project_without_ppp_files");
    expect(record!.fileName).toBe("contract.pdf");
    expect(record!.legacyData).toBe(SMALL_BASE64);
    expect(record!.storagePath).toBeNull();
    expect(record!.storageBucket).toBeNull();
  });

  it("surfaces storage metadata so storage-backed records download via signed URL", async () => {
    mocks.dbSelectResult = [
      {
        id: 6,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        legacyData: null,
        storageBucket: "projects-without-ppp",
        storagePath: "v1/project-1/abc-123",
        storageSize: 42,
        storageMimeType: "application/pdf",
      },
    ];

    const record = await getStoredFileRecord("project_without_ppp_files", 6);
    expect(record).not.toBeNull();
    expect(record!.source).toBe("project_without_ppp_files");
    expect(record!.legacyData).toBeNull();
    expect(record!.storageBucket).toBe("projects-without-ppp");
    expect(record!.storagePath).toBe("v1/project-1/abc-123");
    expect(record!.storageSize).toBe(42);
  });
});
