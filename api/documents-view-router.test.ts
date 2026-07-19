import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createDocumentsViewRouter, type DocumentsViewDependencies } from "./documents-view-router";
import { sanitizeFilename } from "./lib/filename-sanitizer";

// Mock Supabase storage
const mockCreateSignedUrl = vi.fn();
const mockSupabaseStorage = {
  storage: {
    from: vi.fn(() => ({
      createSignedUrl: mockCreateSignedUrl,
    })),
  },
};

vi.doMock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => mockSupabaseStorage),
  getSupabaseStorageConfig: vi.fn(() => ({
    STORAGE_UPLOADS_ENABLED: true,
    buckets: { docFiles: "doc_files" },
  })),
}));

describe("documents-view-router behavioral tests", () => {
  type MockDb = {
    select: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
  
  let mockDb: MockDb;
  let mockGetParsedDocumentFile: ReturnType<typeof vi.fn>;
  let mockConsoleError: ReturnType<typeof vi.fn>;
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockReset();
    
    mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      execute: vi.fn(),
    };

    mockGetParsedDocumentFile = vi.fn();
    mockConsoleError = vi.fn();

    const deps: DocumentsViewDependencies = {
      getDb: () => mockDb,
      getParsedDocumentFile: mockGetParsedDocumentFile as unknown as DocumentsViewDependencies["getParsedDocumentFile"],
      parseRangeHeader: (range, totalSize) => {
        if (!range) return null;
        const match = range.match(/^bytes=(\d+)-(\d*)$/);
        if (!match) return "invalid";
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        if (start > end || start >= totalSize || end >= totalSize) return "invalid";
        return { start, end };
      },
      consoleError: mockConsoleError as unknown as DocumentsViewDependencies["consoleError"],
    };

    const router = createDocumentsViewRouter(deps);
    app = new Hono();
    app.route("/api/documents/files", router);
  });

  describe("Legacy file access", () => {
    it("view returns exactly HTTP 200", async () => {
      const pdfData = Buffer.from("%PDF-1.4 fake pdf content");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      expect(response.status).toBe(200);
    });

    it("view returns exact mocked PDF bytes and application/pdf", async () => {
      const pdfData = Buffer.from("%PDF-1.4 fake pdf content");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      const body = await response.arrayBuffer();
      expect(Buffer.from(body).toString()).toBe(pdfData.toString());
    });

    it("download returns exactly HTTP 200", async () => {
      const pdfData = Buffer.from("%PDF-1.4 fake pdf content");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
    });

    it("download returns attachment Content-Disposition", async () => {
      const pdfData = Buffer.from("%PDF-1.4 fake pdf content");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const disposition = response.headers.get("Content-Disposition");
      expect(disposition).toBe('attachment; filename="test.pdf"');
    });
  });

  describe("Content-Disposition sanitization", () => {
    it("filename with quotes cannot inject headers", async () => {
      const pdfData = Buffer.from("%PDF-1.4");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: 'test"evil.pdf',
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const disposition = response.headers.get("Content-Disposition");
      expect(disposition).not.toContain('"evil');
      expect(disposition).toContain('testevil.pdf');
    });

    it("filename with CRLF cannot inject headers", async () => {
      const pdfData = Buffer.from("%PDF-1.4");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test.pdf\r\nSet-Cookie: evil",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const disposition = response.headers.get("Content-Disposition");
      expect(disposition).not.toContain("\\r");
      expect(disposition).not.toContain("\\n");
      expect(disposition).toContain("test.pdfSet-Cookie: evil");
    });

    it("filename with control characters cannot inject headers", async () => {
      const pdfData = Buffer.from("%PDF-1.4");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "test\x00\x01evil.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const disposition = response.headers.get("Content-Disposition");
      expect(disposition).toContain("testevil.pdf");
    });

    it("filename with backslashes converts to forward slashes", async () => {
      const pdfData = Buffer.from("%PDF-1.4");
      mockGetParsedDocumentFile.mockResolvedValue({
        fileName: "path\\to\\file.pdf",
        parsed: {
          buffer: pdfData,
          mimeType: "application/pdf",
        },
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const disposition = response.headers.get("Content-Disposition");
      expect(disposition).toContain("path/to/file.pdf");
    });
  });

  describe("Storage-backed redirects", () => {
    it("storage-backed view returns HTTP 302 to storage route", async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ storagePath: "doc_files/1/test.pdf" }])),
          })),
        })),
      });

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/api/storage/files/doc_files/1/view");
    });

    it("storage-backed download returns HTTP 302 to storage route", async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ storagePath: "doc_files/1/test.pdf" }])),
          })),
        })),
      });

      const response = await app.request("/api/documents/files/1/download", {
        method: "GET",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/api/storage/files/doc_files/1/download");
    });
  });

  describe("Error handling", () => {
    it("missing file returns exactly HTTP 404", async () => {
      mockGetParsedDocumentFile.mockResolvedValue(null);

      const response = await app.request("/api/documents/files/999/view", {
        method: "GET",
      });

      expect(response.status).toBe(404);
      const body = await response.json() as { error: string };
      expect(body.error).toBe("File not found");
    });

    it("database failure returns exactly HTTP 500 with sanitized message", async () => {
      mockGetParsedDocumentFile.mockRejectedValue(new Error("connection refused: postgres://secret@host"));

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      expect(response.status).toBe(500);
      const body = await response.json() as { error: string };
      expect(body.error).toBe("Unable to access file.");
    });

    it("error response does not contain sentinel SQL string", async () => {
      mockGetParsedDocumentFile.mockRejectedValue(new Error("SELECT * FROM secret_table"));

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      const text = await response.text();
      expect(text).not.toContain("SELECT");
      expect(text).not.toContain("secret_table");
    });

    it("error response does not contain client identifier", async () => {
      mockGetParsedDocumentFile.mockRejectedValue(new Error("client-12345-failed"));

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      const text = await response.text();
      expect(text).not.toContain("client-12345");
    });

    it("error response does not contain internal path", async () => {
      mockGetParsedDocumentFile.mockRejectedValue(new Error("/internal/path/to/file"));

      const response = await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      const text = await response.text();
      expect(text).not.toContain("/internal/");
    });

    it("console output does not contain error message with sensitive data", async () => {
      mockGetParsedDocumentFile.mockRejectedValue(new Error("secret data exposed"));

      await app.request("/api/documents/files/1/view", {
        method: "GET",
      });

      expect(mockConsoleError).toHaveBeenCalledWith("[documents/view] Error: file access failed");
      expect(mockConsoleError).not.toHaveBeenCalledWith(expect.stringContaining("secret data"));
    });
  });
});

describe("sanitizeFilename unit tests", () => {
  it("strips quotes from filename", () => {
    expect(sanitizeFilename('test"evil.pdf')).toBe("testevil.pdf");
    expect(sanitizeFilename("test'evil.pdf")).toBe("testevil.pdf");
  });

  it("strips control characters from filename", () => {
    expect(sanitizeFilename("test\r\nevil.pdf")).toBe("testevil.pdf");
    expect(sanitizeFilename("test\x00evil.pdf")).toBe("testevil.pdf");
  });

  it("converts backslashes to forward slashes", () => {
    expect(sanitizeFilename("path\\to\\file.pdf")).toBe("path/to/file.pdf");
  });

  it("truncates to 255 characters", () => {
    const longName = "a".repeat(300);
    expect(sanitizeFilename(longName).length).toBe(255);
  });

  it("preserves valid filename characters", () => {
    expect(sanitizeFilename("normal-file_v2.pdf")).toBe("normal-file_v2.pdf");
    expect(sanitizeFilename("file with spaces.pdf")).toBe("file with spaces.pdf");
    expect(sanitizeFilename("UPPERCASE.PDF")).toBe("UPPERCASE.PDF");
  });
});
