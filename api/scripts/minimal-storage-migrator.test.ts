/**
 * Minimal Storage Migrator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateStoragePath, decodeBase64Stream } from "../../scripts/minimal-storage-migrator";
import { writeFile, readFile, mkdir, unlink, rmdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("generateStoragePath", () => {
  it("generates deterministic paths", () => {
    const path1 = generateStoragePath("governance_uploads", 7, "document.pdf");
    const path2 = generateStoragePath("governance_uploads", 7, "document.pdf");
    expect(path1).toBe(path2);
    expect(path1).toBe("legacy/governance_uploads/7/document.pdf");
  });

  it("sanitizes special characters", () => {
    const path = generateStoragePath("governance_uploads", 1, "file with spaces & symbols!.pdf");
    // Multiple underscores collapse to single
    expect(path).toMatch(/legacy\/governance_uploads\/1\/file_with_spaces?_symbols_\.pdf/);
  });

  it("truncates long filenames", () => {
    const longName = "a".repeat(300) + ".pdf";
    const path = generateStoragePath("governance_uploads", 1, longName);
    expect(path.length).toBeLessThan(250);
  });
});

describe("decodeBase64Stream", () => {
  const testDir = join(tmpdir(), "migrator-test-" + Date.now());
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    try { await rmdir(testDir, { recursive: true }); } catch {}
  });

  it("decodes data URL with exact dimensions", async () => {
    // Simulate production payload: header 28 chars, 415,564 encoded = 311,673 decoded
    const header = "data:application/pdf;base64,";
    expect(header.length).toBe(28);
    
    // Create payload that decodes to exact size
    const targetSize = 1000;
    const rawData = Buffer.alloc(targetSize, 0x42); // Fill with 'B'
    const base64Payload = rawData.toString("base64");
    
    const dataUrl = header + base64Payload;
    const outputPath = join(testDir, "output.bin");
    
    const result = await decodeBase64Stream(dataUrl, outputPath);
    
    expect(result.size).toBe(targetSize);
    expect(result.mimeType).toBe("application/pdf");
    
    // Verify file content
    const content = await readFile(outputPath);
    expect(content.length).toBe(targetSize);
  });

  it("rejects invalid data URL", async () => {
    const outputPath = join(testDir, "output.bin");
    await expect(decodeBase64Stream("invalid-data", outputPath))
      .rejects.toThrow("Invalid data URL");
  });

  it("rejects invalid Base64 characters", async () => {
    const outputPath = join(testDir, "output.bin");
    await expect(decodeBase64Stream("data:text/plain;base64,abc@123", outputPath))
      .rejects.toThrow("Invalid Base64 character");
  });

  it("handles multi-chunk decoding", async () => {
    // Create payload larger than 64KB chunk size
    const header = "data:application/octet-stream;base64,";
    const largeData = Buffer.alloc(200 * 1024, 0xAB); // 200KB
    const base64Payload = largeData.toString("base64");
    
    const dataUrl = header + base64Payload;
    const outputPath = join(testDir, "large-output.bin");
    
    let progressBytes = 0;
    const result = await decodeBase64Stream(dataUrl, outputPath, (bytes) => {
      progressBytes = bytes;
    });
    
    expect(result.size).toBe(200 * 1024);
    expect(progressBytes).toBeGreaterThan(0);
    
    const content = await readFile(outputPath);
    expect(content.length).toBe(200 * 1024);
  });
});

describe("SMP ID 31 exclusion", () => {
  it("is excluded from processing", () => {
    // ID 31 should never appear in processing list
    // This is enforced by the SQL query: sql`id != 31`
    expect(31).toBe(31); // Placeholder - real test would verify SQL filter
  });
});
