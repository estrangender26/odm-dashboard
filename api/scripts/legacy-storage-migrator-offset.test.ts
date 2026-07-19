/**
 * SQL Offset and Base64 Start Position Tests
 *
 * Reproduces the production issue where SQL substr starts at the comma
 * instead of the first Base64 character.
 */

import { describe, it, expect } from "vitest";

describe("SQL Offset Arithmetic", () => {
  it("calculates correct SQL start position for data URL", () => {
    // Production data URL: data:application/pdf;base64,<payload>
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
    
    // 0-indexed positions:
    // 0-3: "data"
    // 4: ":"
    // 5-23: "application/pdf"
    // 24: ";"
    // 25-30: "base64"
    // 31: ","
    // 32+: payload
    
    const commaIndex = dataUrl.indexOf(",");
    expect(commaIndex).toBe(27); // 0-indexed position of comma
    
    // parseDataUrlHeader returns headerLength = comma + 1 = 32
    // This means the header is 32 characters long (1-indexed positions 1-32)
    const headerLength = commaIndex + 1;
    expect(headerLength).toBe(28);
    
    // SQL substr is 1-indexed
    // Position 32 is the COMMA itself
    // Position 33 is the first Base64 character
    
    // Current buggy code uses base64Start = headerLength = 32
    // This extracts starting from the COMMA, which is wrong!
    
    // Fixed code should use base64Start = headerLength + 1 = 33
    const correctSqlStart = headerLength + 1;
    expect(correctSqlStart).toBe(29);
    
    // Verify: dataUrl[32] (0-indexed) should be first Base64 char
    expect(dataUrl[28]).toBe("J"); // First character of payload
  });

  it("reproduces production payload dimensions", () => {
    // Production: header length 28, payload 415,564 chars
    // For data:application/pdf;base64,:
    // - "data:" = 5 chars
    // - "application/pdf" = 15 chars  
    // - ";base64," = 8 chars
    // Total: 5 + 15 + 8 = 28 chars
    
    const productionHeader = "data:application/pdf;base64,";
    expect(productionHeader.length).toBe(28);
    
    // SQL substr should start at position 29 (1-indexed)
    // Position 28 is the comma, position 29 is first Base64 char
    const sqlStartPosition = productionHeader.length + 1;
    expect(sqlStartPosition).toBe(29);
  });

  it("demonstrates the comma extraction bug", () => {
    // If we extract at position 28 (headerLength), we get the comma
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
    const headerLength = 28;
    
    // SQL substr starting at position 28 (1-indexed)
    // In JavaScript: dataUrl.substring(27) (0-indexed)
    const wrongExtraction = dataUrl.substring(headerLength - 1); // Position 28 in 1-indexed = index 27 in 0-indexed
    
    // This includes the comma!
    expect(wrongExtraction.startsWith(",")).toBe(true);
    expect(wrongExtraction).toBe(",JVBERi0xLjQ=");
    
    // Correct extraction should start after comma
    const correctExtraction = dataUrl.substring(headerLength); // Position 29 in 1-indexed = index 28 in 0-indexed
    expect(correctExtraction.startsWith(",")).toBe(false);
    expect(correctExtraction).toBe("JVBERi0xLjQ=");
  });

  it("validates Base64 would fail with comma prefix", () => {
    const validBase64 = "JVBERi0xLjQ=";
    const invalidWithComma = ",JVBERi0xLjQ=";
    
    // Valid Base64 regex
    const base64Regex = /^[A-Za-z0-9+/]*=?=?=?$/;
    
    expect(base64Regex.test(validBase64)).toBe(true);
    expect(base64Regex.test(invalidWithComma)).toBe(false); // Comma makes it invalid
  });
});

describe("decodeWithHeartbeat Offset Bug", () => {
  it("current code uses wrong start position", () => {
    // Current buggy code:
    // const base64Start = headerInfo.headerLength > 0 ? headerInfo.headerLength : 1;
    
    // For production header length 28:
    // base64Start = 28
    // SQL: substr(file_url, 28, chunk_size) -- extracts FROM the comma!
    
    // This is wrong. Should be:
    // base64Start = headerInfo.headerLength + 1 = 29
    // SQL: substr(file_url, 29, chunk_size) -- extracts after comma
    
    const headerLength = 28;
    const buggyStart = headerLength > 0 ? headerLength : 1;
    const correctStart = headerLength > 0 ? headerLength + 1 : 1;
    
    expect(buggyStart).toBe(28); // Wrong - starts at comma
    expect(correctStart).toBe(29); // Correct - starts after comma
  });
});
