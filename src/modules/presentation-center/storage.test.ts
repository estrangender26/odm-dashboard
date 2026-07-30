/**
 * Storage utility tests - Node.js compatible
 */

import { describe, it, expect } from "vitest";
import { blobToBuffer, blobToDataUrl, blobToUint8Array } from "./storage";

describe("blobToBuffer", () => {
  it("should convert Blob to Buffer in Node", async () => {
    const blob = new Blob(["test data"], { type: "text/plain" });
    const buffer = await blobToBuffer(blob);
    
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString()).toBe("test data");
  });
  
  it("should handle empty blob", async () => {
    const blob = new Blob([]);
    const buffer = await blobToBuffer(blob);
    
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(0);
  });
});

describe("blobToUint8Array", () => {
  it("should convert Blob to Uint8Array", async () => {
    const blob = new Blob(["test data"], { type: "text/plain" });
    const arr = await blobToUint8Array(blob);
    
    expect(arr).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(arr)).toBe("test data");
  });
});

describe("blobToDataUrl", () => {
  it("should convert Blob to data URL without FileReader", async () => {
    const blob = new Blob(["test data"], { type: "text/plain" });
    const dataUrl = await blobToDataUrl(blob);
    
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    expect(dataUrl).toContain("dGVzdCBkYXRh"); // base64 for "test data"
  });
  
  it("should handle binary data", async () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const blob = new Blob([binary], { type: "application/octet-stream" });
    const dataUrl = await blobToDataUrl(blob);
    
    expect(dataUrl).toMatch(/^data:application\/octet-stream;base64,/);
  });
  
  it("should preserve mime type", async () => {
    const blob = new Blob(["{}"], { type: "application/json" });
    const dataUrl = await blobToDataUrl(blob);
    
    expect(dataUrl).toMatch(/^data:application\/json;base64,/);
  });
});
