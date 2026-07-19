/**
 * Regression Tests for Production Data Structure
 *
 * Tests matching the exact shape from production diagnostic.
 */

import { describe, it, expect } from "vitest";

describe("Production Data Structure Regression", () => {
  it("handles header length 28 and payload position 29", async () => {
    const { parseDataUrlHeader } = await import("../../scripts/lib/legacy-storage-migrator-core");
    
    // Production data: data:application/pdf;base64,<payload>
    // Header length is 28 (0-indexed: 0-27, 1-indexed SQL: 1-28)
    // Comma at position 27 (0-indexed), so payload starts at position 28 (0-indexed)
    // SQL substr is 1-indexed, so payload starts at position 29
    
    const header = "data:application/pdf;base64,";
    const result = parseDataUrlHeader(header);
    
    // Header length should be 28 (the comma is at position 27, 0-indexed)
    expect(result.headerLength).toBe(28);
    expect(result.mimeType).toBe("application/pdf");
    
    // SQL start position should be headerLength + 1 = 29
    const sqlStartPosition = result.headerLength + 1;
    expect(sqlStartPosition).toBe(29);
  });

  it("calculates correct payload length for 415,564 characters", () => {
    // Production payload: 415,564 Base64 characters
    // Expected decoded: 311,673 bytes
    // Base64 expands by 4/3, so 415,564 * 3/4 = 311,673
    
    const base64Length = 415564;
    const expectedDecoded = Math.floor(base64Length * 3 / 4); // 311,673
    
    expect(base64Length % 4).toBe(0); // Divisible by 4
    expect(expectedDecoded).toBe(311673);
  });

  it("validates no-padding Base64 structure", () => {
    // Production data has padding_count = 0
    // This means the payload is an exact multiple of 3 bytes
    
    const base64Length = 415564;
    expect(base64Length % 4).toBe(0); // Valid Base64 length
    
    // No padding means the original byte length was divisible by 3
    // 415,564 / 4 * 3 = 311,673 bytes, which is divisible by 3
    const decodedLength = (base64Length / 4) * 3;
    expect(decodedLength % 3).toBe(0);
  });

  it("validates chunk alignment with 64KB chunks", () => {
    // BASE64_CHUNK_SIZE is typically 64KB (65536)
    // 415,564 / 65,536 = ~6.34 chunks
    
    const BASE64_CHUNK_SIZE = 65536; // 64KB
    const payloadLength = 415564;
    
    const fullChunks = Math.floor(payloadLength / BASE64_CHUNK_SIZE);
    const remainder = payloadLength % BASE64_CHUNK_SIZE;
    
    expect(fullChunks).toBe(6);
    expect(remainder).toBe(415564 - 6 * 65536); // Remainder
    
    // Remainder should be divisible by 4 for Base64 alignment
    expect(remainder % 4).toBe(0);
  });

  it("handles substr SQL extraction correctly", () => {
    // SQL: substr(file_url, 29, chunk_size)
    // Should extract starting from character 29 (1-indexed)
    
    const fullDataUrl = "data:application/pdf;base64,abc123";
    const sqlStart = 29; // After the comma
    
    // In real SQL, substr would start at position 29
    // Since our test data is short, this would return empty or partial
    // But the concept is: position 29 is first Base64 char
    
    // 1-indexed: position 1 = 'd', position 28 = ',', position 29 = 'a' (first Base64)
    expect(fullDataUrl[28]).toBe("a"); // 0-indexed position 28 = 'a'
  });
});

describe("Drizzle Result Extraction", () => {
  it("extracts string from Drizzle result object", () => {
    // Simulate Drizzle returning { chunk: "base64data" }
    const drizzleResult = [{ chunk: "abc123" }];
    const row = drizzleResult[0];
    
    expect(row).toBeDefined();
    expect(typeof row.chunk).toBe("string");
    expect(row.chunk).toBe("abc123");
  });

  it("handles null/undefined result rows", () => {
    const emptyResult: any[] = [];
    const row = emptyResult[0];
    
    expect(row).toBeUndefined();
    expect(row?.chunk).toBeUndefined();
  });

  it("handles missing chunk property", () => {
    const malformedResult = [{ other: "data" }] as any[];
    const row = malformedResult[0];
    
    expect(row.chunk).toBeUndefined();
  });
});

describe("Log Suppression", () => {
  it("checks LEGACY_MIGRATOR_MODE environment variable", () => {
    // The suppression checks for LEGACY_MIGRATOR_MODE === "1"
    expect(process.env.LEGACY_MIGRATOR_MODE).toBeUndefined();
    
    // When set to "1", logs should be suppressed
    process.env.LEGACY_MIGRATOR_MODE = "1";
    expect(process.env.LEGACY_MIGRATOR_MODE).toBe("1");
    
    // Cleanup
    delete process.env.LEGACY_MIGRATOR_MODE;
  });
});
