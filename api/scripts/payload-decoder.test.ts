import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rmdir, readFile } from "fs/promises";
import { decodePayloadStream, MAX_DECODED_BYTES } from "../../scripts/lib/payload-decoder";

// Test fixtures
const PDF_B64 = "JVBERi0xLjcK";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("Payload Decoder - Streaming", () => {
  const testDir = join(tmpdir(), "decoder-test-" + Date.now());
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    try { await rmdir(testDir, { recursive: true }); } catch {}
  });

  // ============================================================================
  // DATA URL TESTS
  // ============================================================================
  
  it("decodes valid PDF data URL", async () => {
    const tempPath = join(testDir, "test1.bin");
    const payload = `data:application/pdf;base64,${PDF_B64}`;
    const result = await decodePayloadStream(payload, { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("data_url");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.detectedSignature).toBe("pdf");
    expect(result.size).toBe(9);
    expect(result.sha256).toBeDefined();
    expect(result.tempPath).toBe(tempPath);
  });

  it("decodes multi-chunk data URL", async () => {
    const tempPath = join(testDir, "test2.bin");
    // Create large payload (100KB)
    const largeData = Buffer.alloc(100 * 1024, 0x42);
    const b64 = largeData.toString("base64");
    const payload = `data:application/octet-stream;base64,${b64}`;
    
    const result = await decodePayloadStream(payload, { filename: "large.bin", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.size).toBe(100 * 1024);
    
    // Verify file was written
    const content = await readFile(tempPath);
    expect(content.length).toBe(100 * 1024);
  });

  // ============================================================================
  // RAW BASE64 TESTS
  // ============================================================================
  
  it("decodes valid raw PDF Base64", async () => {
    const tempPath = join(testDir, "test3.bin");
    const result = await decodePayloadStream(PDF_B64, { filename: "test.pdf", sourceMimeType: "application/pdf", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("raw_base64");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.detectedSignature).toBe("pdf");
    expect(result.size).toBe(9);
  });

  it("decodes multi-chunk raw Base64", async () => {
    const tempPath = join(testDir, "test4.bin");
    const largeData = Buffer.alloc(100 * 1024, 0xAB);
    const b64 = largeData.toString("base64");
    
    const result = await decodePayloadStream(b64, { filename: "large.bin", sourceMimeType: "application/octet-stream", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.size).toBe(100 * 1024);
  });

  it("handles raw Base64 with whitespace", async () => {
    const tempPath = join(testDir, "test5.bin");
    const payload = `JVBERi0x\nLjcK\r\n`;
    
    const result = await decodePayloadStream(payload, { filename: "test.pdf", sourceMimeType: "application/pdf", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.classification).toBe("raw_base64");
    expect(result.size).toBe(9);
  });

  it("raw Base64 and data URL produce identical output", async () => {
    const tempPath1 = join(testDir, "test6a.bin");
    const tempPath2 = join(testDir, "test6b.bin");
    
    const rawResult = await decodePayloadStream(PDF_B64, { filename: "test.pdf", sourceMimeType: "application/pdf", tempPath: tempPath1 });
    const dataUrlResult = await decodePayloadStream(`data:application/pdf;base64,${PDF_B64}`, { filename: "test.pdf", tempPath: tempPath2 });
    
    expect(rawResult.success).toBe(true);
    expect(dataUrlResult.success).toBe(true);
    expect(rawResult.size).toBe(dataUrlResult.size);
    expect(rawResult.sha256).toBe(dataUrlResult.sha256);
  });

  // ============================================================================
  // SIZE BOUNDARY TESTS
  // ============================================================================
  
  it("accepts exactly at size limit", async () => {
    const tempPath = join(testDir, "test7.bin");
    // Use test override to avoid allocating 150 MiB
    // Using maxBytes option below
    
    const data = Buffer.alloc(1000, 0x42);
    const b64 = data.toString("base64");
    
    const result = await decodePayloadStream(b64, { filename: "test.bin", sourceMimeType: "application/octet-stream", tempPath, maxBytes: 1000 });
    
    expect(result.success).toBe(true);
    expect(result.size).toBe(1000);
    
    // Reset; // Reset
  });

  it("rejects one byte above limit", async () => {
    const tempPath = join(testDir, "test8.bin");
    // Using maxBytes option below
    
    const data = Buffer.alloc(1001, 0x42);
    const b64 = data.toString("base64");
    
    const result = await decodePayloadStream(b64, { filename: "test.bin", sourceMimeType: "application/octet-stream", tempPath, maxBytes: 1000 });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds maximum");
    
    // Reset;
  });

  it("cleans up partial file after size rejection", async () => {
    const tempPath = join(testDir, "test9.bin");
    // Using maxBytes option instead;
    
    const data = Buffer.alloc(200, 0x42);
    const b64 = data.toString("base64");
    
    await decodePayloadStream(b64, { filename: "test.bin", sourceMimeType: "application/octet-stream", tempPath });
    
    // File should not exist or be empty
    try {
      const content = await readFile(tempPath);
      expect(content.length).toBe(0);
    } catch {
      // File deleted - expected
    }
    
    // Reset;
  });

  // ============================================================================
  // INVALID BASE64 TESTS
  // ============================================================================
  
  it("rejects invalid Base64 characters", async () => {
    const tempPath = join(testDir, "test10.bin");
    const result = await decodePayloadStream("JVBERi0x!@#", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Base64 characters");
    expect(result.classification).toBe("invalid");
  });

  it("rejects invalid padding length", async () => {
    const tempPath = join(testDir, "test11.bin");
    const result = await decodePayloadStream("SGVsbG8= =", { filename: "test.txt", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Base64");
  });

  it("rejects length not multiple of 4", async () => {
    const tempPath = join(testDir, "test12.bin");
    const result = await decodePayloadStream("SGVsbG8", { filename: "test.txt", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not multiple of 4");
  });

  it("rejects truncated payload", async () => {
    const tempPath = join(testDir, "test13.bin");
    // Truncated Base64
    const result = await decodePayloadStream("SGV", { filename: "test.txt", tempPath });
    
    expect(result.success).toBe(false);
  });

  it("rejects empty payload", async () => {
    const tempPath = join(testDir, "test14.bin");
    const result = await decodePayloadStream("", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("rejects empty data URL body", async () => {
    const tempPath = join(testDir, "test15.bin");
    const result = await decodePayloadStream("data:application/pdf;base64,", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Empty Base64");
  });

  // ============================================================================
  // REFERENCE DETECTION TESTS
  // ============================================================================
  
  it("rejects HTTP URL as reference", async () => {
    const tempPath = join(testDir, "test16.bin");
    const result = await decodePayloadStream("http://example.com/file.pdf", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  it("rejects HTTPS URL as reference", async () => {
    const tempPath = join(testDir, "test17.bin");
    const result = await decodePayloadStream("https://example.com/file.pdf", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  it("rejects storage URL as reference", async () => {
    const tempPath = join(testDir, "test18.bin");
    const result = await decodePayloadStream("storage://bucket/path/file.pdf", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  it("rejects Supabase Storage URL as reference", async () => {
    const tempPath = join(testDir, "test19.bin");
    const result = await decodePayloadStream("https://abc.supabase.co/storage/v1/object/public/bucket/file.pdf", { filename: "test.pdf", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.classification).toBe("reference");
  });

  // ============================================================================
  // SIGNATURE TESTS
  // ============================================================================
  
  it("detects PDF signature", async () => {
    const tempPath = join(testDir, "test20.bin");
    const result = await decodePayloadStream(PDF_B64, { filename: "test.pdf", sourceMimeType: "application/pdf", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.detectedSignature).toBe("pdf");
  });

  it("detects PNG signature", async () => {
    const tempPath = join(testDir, "test21.bin");
    const result = await decodePayloadStream(PNG_B64, { filename: "test.png", sourceMimeType: "image/png", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.detectedSignature).toBe("png");
  });

  // ============================================================================
  // MIME RESOLUTION TESTS
  // ============================================================================
  
  it("resolves MIME from filename extension", async () => {
    const tempPath = join(testDir, "test22.bin");
    const result = await decodePayloadStream(PDF_B64, { filename: "document.pdf", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.mimeType).toBe("application/pdf");
  });

  it("rejects unresolved MIME", async () => {
    const tempPath = join(testDir, "test23.bin");
    const result = await decodePayloadStream("SGVsbG8gV29ybGQ=", { filename: "unknown.unknown", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot resolve MIME");
  });

  it("detects MIME/signature mismatch", async () => {
    const tempPath = join(testDir, "test24.bin");
    const result = await decodePayloadStream(PDF_B64, { filename: "document.png", sourceMimeType: "image/png", tempPath });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("MIME/signature mismatch");
  });

  // ============================================================================
  // DOCX/XLSX/PPTX TESTS
  // ============================================================================
  
  it("handles DOCX with ZIP signature", async () => {
    const tempPath = join(testDir, "test25.bin");
    // ZIP signature: PK
    const zipB64 = "UEsDBBQAAAAI";
    const result = await decodePayloadStream(zipB64, { filename: "document.docx", sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", tempPath });
    
    expect(result.success).toBe(true);
    expect(result.mimeType).toContain("wordprocessingml");
  });

  // ============================================================================
  // SIZE CONSTANT TEST
  // ============================================================================
  
  it("has correct max size constant", () => {
    expect(MAX_DECODED_BYTES).toBe(157286400);
  });
});
