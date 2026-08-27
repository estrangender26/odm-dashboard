import { describe, expect, it } from "vitest";
import { validateUploadDescriptor } from "./storage-validation";

describe("projects_without_ppp masterdata file validation (server-enforced)", () => {
  it("accepts .xlsx Excel masterdata", () => {
    const d = validateUploadDescriptor(
      "projects_without_ppp",
      "masterdata.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(d).toEqual({
      extension: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("accepts .pdf masterdata", () => {
    const d = validateUploadDescriptor("projects_without_ppp", "masterdata.pdf", "application/pdf");
    expect(d).toEqual({ extension: "pdf", mimeType: "application/pdf" });
  });

  it("accepts .xls masterdata only because the repository validates it safely (application/vnd.ms-excel)", () => {
    const d = validateUploadDescriptor("projects_without_ppp", "masterdata.xls", "application/vnd.ms-excel");
    expect(d).toEqual({ extension: "xls", mimeType: "application/vnd.ms-excel" });
  });

  it("rejects .exe", () => {
    expect(() => validateUploadDescriptor("projects_without_ppp", "evil.exe", "application/octet-stream")).toThrow(
      "File extension is not allowed",
    );
  });

  it("rejects .zip", () => {
    expect(() => validateUploadDescriptor("projects_without_ppp", "evil.zip", "application/zip")).toThrow(
      "File extension is not allowed",
    );
  });

  it("rejects images", () => {
    expect(() => validateUploadDescriptor("projects_without_ppp", "photo.png", "image/png")).toThrow(
      "File extension is not allowed",
    );
  });

  it("rejects arbitrary text files", () => {
    expect(() => validateUploadDescriptor("projects_without_ppp", "notes.txt", "text/plain")).toThrow(
      "File extension is not allowed",
    );
  });

  it("rejects a mismatched extension/MIME where existing validation supports it", () => {
    expect(() =>
      validateUploadDescriptor("projects_without_ppp", "masterdata.pdf", "application/vnd.ms-excel"),
    ).toThrow("File MIME type does not match its extension.");
  });

  it("rejects path separators and dotfiles in filenames", () => {
    expect(() => validateUploadDescriptor("projects_without_ppp", "../masterdata.pdf", "application/pdf")).toThrow(
      "Invalid filename.",
    );
    expect(() => validateUploadDescriptor("projects_without_ppp", "..", "application/pdf")).toThrow(
      "Invalid filename.",
    );
  });
});
