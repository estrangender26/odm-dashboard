import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPresentationFileDownloadUrl,
  listPresentationFiles,
  uploadPresentationFile,
} from "./presentationFilesApi";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("presentation files API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists files from /api/presentation-files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          {
            id: 1,
            fileName: "test.pptx",
            displayName: "test.pptx",
            fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            fileSizeBytes: 100,
            sha256Hash: "abc",
            fileCategory: "uploaded_deck",
            title: "Test Presentation",
            version: "1.0",
            originalFileUrl: "/api/presentation-files/1/download",
            uploadedBy: "Test User",
            createdAt: "2026-06-01T10:00:00Z",
            updatedAt: "2026-06-01T10:00:00Z",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const files = await listPresentationFiles({ fileCategory: "uploaded_deck" });

    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files?file_category=uploaded_deck",
      { headers: { Accept: "application/json" } }
    );
  });

  it("uploads a file via multipart POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 2,
          fileName: "upload.pptx",
          displayName: "upload.pptx",
          fileType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          fileSizeBytes: 200,
          sha256Hash: "def",
          fileCategory: "uploaded_deck",
          title: "upload.pptx",
          version: "1.0",
          originalFileUrl: "/api/presentation-files/2/download",
          uploadedBy: "ODM User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-01T10:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["pptx"], "upload.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const result = await uploadPresentationFile(file, {
      fileCategory: "uploaded_deck",
      uploadedBy: "ODM User",
    });

    expect(result.id).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files/upload",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("builds download URL with file id", () => {
    expect(getPresentationFileDownloadUrl(42)).toBe(
      "/api/presentation-files/42/download"
    );
  });
});
