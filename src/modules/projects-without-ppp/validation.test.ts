import { describe, expect, it } from "vitest";
import { validateMasterdataFile } from "./validation";
import { MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("client-side masterdata file validation (UX mirror of server rules)", () => {
  it("accepts .xlsx", () => {
    expect(
      validateMasterdataFile(makeFile("masterdata.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
    ).toBeNull();
  });

  it("accepts .pdf", () => {
    expect(validateMasterdataFile(makeFile("masterdata.pdf", "application/pdf"))).toBeNull();
  });

  it("accepts .xls with the repository-supported MIME", () => {
    expect(validateMasterdataFile(makeFile("masterdata.xls", "application/vnd.ms-excel"))).toBeNull();
  });

  it("rejects .exe, .zip and images", () => {
    expect(validateMasterdataFile(makeFile("a.exe", "application/octet-stream"))).not.toBeNull();
    expect(validateMasterdataFile(makeFile("a.zip", "application/zip"))).not.toBeNull();
    expect(validateMasterdataFile(makeFile("a.png", "image/png"))).not.toBeNull();
    expect(validateMasterdataFile(makeFile("a.txt", "text/plain"))).not.toBeNull();
  });

  it("rejects extension/MIME mismatch", () => {
    expect(validateMasterdataFile(makeFile("masterdata.pdf", "image/png"))).not.toBeNull();
  });

  it("accepts exactly 150 MB", () => {
    const file = makeFile("big.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", MAX_UPLOAD_FILE_SIZE_BYTES);
    expect(validateMasterdataFile(file)).toBeNull();
  });

  it("rejects over 150 MB", () => {
    const file = makeFile("bigger.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", MAX_UPLOAD_FILE_SIZE_BYTES + 1);
    const error = validateMasterdataFile(file);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("150 MB");
  });
});
