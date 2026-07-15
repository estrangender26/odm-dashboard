import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_BODY_LIMIT_BYTES,
  MAX_BASE64_UPLOAD_BODY_SIZE_BYTES,
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  getDecodedBase64ByteLength,
  getDecodedBase64ByteLengthFromEncoding,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import {
  getRequestBodyLimitBytes,
  isLargeUploadRequestPath,
} from "./upload-body-limit";

describe("shared upload limits", () => {
  it("accepts the exact 150 MB boundary", () => {
    expect(MAX_UPLOAD_FILE_SIZE_BYTES).toBe(157_286_400);
    expect(isUploadFileSizeAllowed(157_286_400)).toBe(true);
  });

  it("rejects one byte over the 150 MB boundary", () => {
    expect(isUploadFileSizeAllowed(157_286_401)).toBe(false);
    expect(MAX_UPLOAD_ERROR_MESSAGE).toBe("Maximum file size is 150 MB.");
  });

  it("enforces the boundary using decoded base64 byte length", () => {
    const exactDecodedSize = getDecodedBase64ByteLengthFromEncoding(
      209_715_200,
      0,
    );
    const oneByteOverDecodedSize = getDecodedBase64ByteLengthFromEncoding(
      209_715_204,
      2,
    );

    expect(exactDecodedSize).toBe(157_286_400);
    expect(oneByteOverDecodedSize).toBe(157_286_401);
    expect(isUploadFileSizeAllowed(exactDecodedSize!)).toBe(true);
    expect(isUploadFileSizeAllowed(oneByteOverDecodedSize!)).toBe(false);
  });

  it("continues accepting smaller uploads", () => {
    expect(isUploadFileSizeAllowed(1)).toBe(true);
    expect(isUploadFileSizeAllowed(25 * 1024 * 1024)).toBe(true);
  });

  it("calculates actual decoded sizes for raw base64 and data URLs", () => {
    expect(getDecodedBase64ByteLength("YQ==")).toBe(1);
    expect(getDecodedBase64ByteLength("data:text/plain;base64,YWJj")).toBe(3);
  });
});

describe("route-specific request body limits", () => {
  it.each([
    "/api/trpc/documents.uploadFile",
    "/api/trpc/governance.addUpload",
    "/api/trpc/govFiles.upload",
    "/api/trpc/smp.create",
    "/api/trpc/smp.update",
    "/api/governance/files",
  ])("allows base64 transport overhead for %s", (path) => {
    expect(isLargeUploadRequestPath(path)).toBe(true);
    expect(getRequestBodyLimitBytes(path)).toBe(MAX_BASE64_UPLOAD_BODY_SIZE_BYTES);
  });

  it("recognizes affected procedures inside a tRPC batch", () => {
    expect(isLargeUploadRequestPath("/api/trpc/smp.list,smp.update")).toBe(true);
  });

  it.each([
    "/api/presentation-files/upload",
    "/api/trpc/tasks.import",
    "/api/trpc/governance.uploads",
  ])("keeps unrelated API %s at 50 MB", (path) => {
    expect(isLargeUploadRequestPath(path)).toBe(false);
    expect(getRequestBodyLimitBytes(path)).toBe(DEFAULT_API_BODY_LIMIT_BYTES);
    expect(getRequestBodyLimitBytes(path)).toBe(50 * 1024 * 1024);
  });
});
