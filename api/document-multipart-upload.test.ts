import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_ERROR_MESSAGE } from "@contracts/upload-limits";
import {
  cleanupDocumentMultipartUpload,
  DocumentMultipartUploadError,
  parseDocumentMultipartUpload,
} from "./document-multipart-upload";

function makeMultipartRequest(fileBytes: number, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBytes)], { type: "application/pdf" }), "test.pdf");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: form,
  });
}

describe("streaming document multipart parser", () => {
  it("accepts a file exactly at the configured boundary", async () => {
    const upload = await parseDocumentMultipartUpload(
      makeMultipartRequest(4, { folderId: "88", uploadedBy: "test" }),
      { maxFileSizeBytes: 4 },
    );
    try {
      expect(upload.fileSize).toBe(4);
      expect(upload.fileName).toBe("test.pdf");
      expect(upload.fields.folderId).toBe("88");
      expect((await stat(upload.tempFilePath)).size).toBe(4);
    } finally {
      await cleanupDocumentMultipartUpload(upload);
    }
  });

  it("rejects one byte over before handler continuation or database insertion", async () => {
    let insertCalled = false;
    let caught: unknown;
    try {
      await parseDocumentMultipartUpload(
        makeMultipartRequest(5, { folderId: "88" }),
        { maxFileSizeBytes: 4 },
      );
      insertCalled = true;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DocumentMultipartUploadError);
    expect((caught as DocumentMultipartUploadError).status).toBe(413);
    expect((caught as Error).message).toBe(MAX_UPLOAD_ERROR_MESSAGE);
    expect(insertCalled).toBe(false);
  });

  it("continues accepting smaller uploads", async () => {
    const upload = await parseDocumentMultipartUpload(makeMultipartRequest(2), {
      maxFileSizeBytes: 4,
    });
    try {
      expect(upload.fileSize).toBe(2);
    } finally {
      await cleanupDocumentMultipartUpload(upload);
    }
  });

  it("rejects multiple file parts", async () => {
    const form = new FormData();
    form.append("file", new Blob(["one"]), "one.pdf");
    form.append("file", new Blob(["two"]), "two.pdf");
    const request = new Request("http://localhost/api/documents/upload", {
      method: "POST",
      body: form,
    });

    await expect(parseDocumentMultipartUpload(request, { maxFileSizeBytes: 10 }))
      .rejects.toMatchObject({ status: 400 });
  });
});
