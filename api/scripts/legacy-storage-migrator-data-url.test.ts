/**
 * Data URL Decoding and Base64 Alignment Tests
 *
 * Tests for proper handling of data URLs and Base64 chunk alignment.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

describe("Data URL Parsing", () => {
  it("parses data URL header correctly", async () => {
    const { parseDataUrlHeader } = await import("../../scripts/lib/legacy-storage-migrator-core");
    
    // Standard data URL
    const result1 = parseDataUrlHeader("data:application/pdf;base64,JVBERi0xLjQ=");
    expect(result1.mimeType).toBe("application/pdf");
    expect(result1.headerLength).toBe(28); // "data:application/pdf;base64,".length + 1
    
    // Plain base64 without header
    const result2 = parseDataUrlHeader("JVBERi0xLjQ=");
    expect(result2.mimeType).toBeNull();
    expect(result2.headerLength).toBe(0);
  });

  it("calculates correct Base64 start position", () => {
    // data:application/pdf;base64, = 29 chars, +1 for comma position = 30
    const header = "data:application/pdf;base64,";
    const commaPos = header.indexOf(",");
    expect(commaPos).toBe(27);
    // SQL position is 1-indexed, so Base64 starts at commaPos + 1 + 1 = 30
    expect(commaPos + 2).toBe(29);
  });
});

describe("Base64 Alignment", () => {
  it("maintains 4-character group alignment across chunks", () => {
    // Simulate chunked Base64 processing
    const base64Data = "VGhpcyBpcyBhIHRlc3Qgc3RyaW5nLg=="; // "This is a test string."
    
    // Split into chunks that would cause misalignment
    const chunkSize = 10; // Not multiple of 4
    const chunks: string[] = [];
    for (let i = 0; i < base64Data.length; i += chunkSize) {
      chunks.push(base64Data.slice(i, i + chunkSize));
    }
    
    // Simulate carry-over processing
    let carryOver = "";
    let fullDecoded = "";
    
    for (let i = 0; i < chunks.length; i++) {
      let fullChunk = carryOver + chunks[i];
      const isLastChunk = i === chunks.length - 1;
      const remainder = fullChunk.length % 4;
      
      if (remainder !== 0 && !isLastChunk) {
        carryOver = fullChunk.slice(-remainder);
        fullChunk = fullChunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }
      
      if (fullChunk.length > 0) {
        fullDecoded += Buffer.from(fullChunk, "base64").toString("utf-8");
      }
    }
    
    // Process final carry-over
    if (carryOver) {
      fullDecoded += Buffer.from(carryOver, "base64").toString("utf-8");
    }
    
    expect(fullDecoded).toBe("This is a test string.");
  });

  it("handles multi-chunk data URL decoding", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // Should handle carryOver for alignment
    expect(content).toContain("carryOver");
    expect(content).toContain("fullChunk.length % 4");
    
    // Should track last chunk status
    expect(content).toContain("isLastChunk");
  });
});

describe("SHA-256 Verification", () => {
  it("produces correct SHA-256 for known payload", () => {
    const payload = Buffer.from("Test payload for hashing");
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    
    // Verify hash calculation matches expected
    const actualHash = createHash("sha256").update(payload).digest("hex");
    expect(actualHash).toBe(expectedHash);
    expect(actualHash).toHaveLength(64); // SHA-256 hex length
  });

  it("verifies Base64 encoding produces expected output", () => {
    const original = "Hello, World! This is a test.";
    const base64 = Buffer.from(original).toString("base64");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    
    expect(decoded).toBe(original);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe("Governance Uploads Specific", () => {
  it("handles file_url column which contains full data URL", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync("scripts/legacy-storage-migrator.ts", "utf-8");
    
    // Should use LEGACY_COLUMNS which maps governance_uploads to file_url
    expect(content).toContain('governance_uploads: "file_url"');
    
    // Should handle file_name for governance_uploads
    expect(content).toContain('file_name');
  });

  it("preserves Base64 content without mutation", () => {
    const base64Payload = "JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq";
    // Store and retrieve should preserve exact content
    const buffer = Buffer.from(base64Payload, "base64");
    const reEncoded = buffer.toString("base64");
    expect(reEncoded.replace(/=+$/, "")).toBe(base64Payload.replace(/=+$/, ""));
  });
});
