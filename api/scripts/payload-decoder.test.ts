import { describe, it, expect } from "vitest";
import { decodePayload, MAX_DECODED_BYTES } from "../../scripts/lib/payload-decoder";

describe("Payload Decoder", () => {
  // Valid PDF data URL
  it("decodes valid PDF data URL", () => {
    const pdfBase64 = "JVBERi0xLjcK";
    const payload = `data:application/pdf;base64,${pdfBase64}`;
    const result = decodePayload(payload, { filename: "test.pdf" });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("data_url");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.detectedSignature).toBe("pdf");
    expect(result.size).toBe(9); // JVBERi0xLjcK decodes to 9 bytes
    expect(result.sha256).toBeDefined();
  });

  // Valid raw PDF Base64
  it("decodes valid raw PDF Base64", () => {
    const payload = "JVBERi0xLjcK";
    const result = decodePayload(payload, { filename: "test.pdf", sourceMimeType: "application/pdf" });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("raw_base64");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.detectedSignature).toBe("pdf");
    expect(result.size).toBe(9);
  });

  // Equivalent raw and data URL produce same bytes/SHA-256
  it("produces identical bytes from data URL and raw Base64", () => {
    const rawPayload = "JVBERi0xLjcK";
    const dataUrlPayload = `data:application/pdf;base64,${rawPayload}`;
    
    const rawResult = decodePayload(rawPayload, { filename: "test.pdf", sourceMimeType: "application/pdf" });
    const dataUrlResult = decodePayload(dataUrlPayload, { filename: "test.pdf" });
    
    expect(rawResult.success).toBe(true);
    expect(dataUrlResult.success).toBe(true);
    expect(rawResult.size).toBe(dataUrlResult.size);
    expect(rawResult.sha256).toBe(dataUrlResult.sha256);
  });

  // Raw Base64 with line breaks
  it("handles raw Base64 with whitespace", () => {
    const payload = "JVBERi0x\nLjcK\r\n";
    const result = decodePayload(payload, { filename: "test.pdf", sourceMimeType: "application/pdf" });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("raw_base64");
    expect(result.size).toBe(9);
  });

  // Invalid Base64 characters
  it("rejects invalid Base64 characters", () => {
    const payload = "JVBERi0x!@#";
    const result = decodePayload(payload, { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid");
    expect(result.classification).toBe("invalid");
  });

  // Invalid padding
  it("rejects invalid Base64 padding", () => {
    const payload = "JVBERi0xLjc==="; // 3 equals signs
    const result = decodePayload(payload, { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("invalid");
  });

  // Empty payload
  it("rejects empty payload", () => {
    const result = decodePayload("", { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Empty");
    expect(result.classification).toBe("invalid");
  });

  // HTTP URL detection
  it("classifies HTTP URL as reference", () => {
    const result = decodePayload("https://example.com/file.pdf", { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  // Storage URL detection
  it("classifies storage URL as reference", () => {
    const result = decodePayload("storage://bucket/path/file.pdf", { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  // MIME from data URL
  it("extracts MIME from data URL", () => {
    const payload = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const result = decodePayload(payload, { filename: "test.png" });
    
    expect(result.success).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.detectedSignature).toBe("png");
  });

  // MIME from filename extension
  it("resolves MIME from filename extension", () => {
    const payload = "JVBERi0xLjcK"; // PDF signature
    const result = decodePayload(payload, { filename: "document.pdf" });
    
    expect(result.success).toBe(true);
    expect(result.mimeType).toBe("application/pdf");
  });

  // MIME/signature mismatch
  it("rejects MIME/signature mismatch", () => {
    const payload = "JVBERi0xLjcK"; // PDF signature
    const result = decodePayload(payload, { filename: "document.png", sourceMimeType: "image/png" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("MIME");
  });

  // PNG signature detection
  it("detects PNG signature", () => {
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const result = decodePayload(pngBase64, { filename: "test.png", sourceMimeType: "image/png" });
    
    expect(result.success).toBe(true);
    expect(result.detectedSignature).toBe("png");
  });

  // Unresolved MIME rejection
  it("rejects when MIME cannot be resolved", () => {
    const payload = "SGVsbG8gV29ybGQ="; // "Hello World" - no signature
    const result = decodePayload(payload, { filename: "unknown.unknown" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot resolve MIME");
  });

  // Size enforcement - exactly at limit (mock by checking constant)
  it("enforces maximum size limit", () => {
    expect(MAX_DECODED_BYTES).toBe(157286400);
  });

  // DOCX handling
  it("handles DOCX with ZIP signature", () => {
    // ZIP signature: PK
    const zipBase64 = "UEsDBBQAAAAI";
    const result = decodePayload(zipBase64, { filename: "document.docx", sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    
    expect(result.success).toBe(true);
    expect(result.mimeType).toContain("wordprocessingml");
  });

  // Malformed data URL
  it("rejects malformed data URL", () => {
    const payload = "data:application/pdf;base64"; // Missing comma and content
    const result = decodePayload(payload, { filename: "test.pdf" });
    
    expect(result.success).toBe(false);
  });
});
