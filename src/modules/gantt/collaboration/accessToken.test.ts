import { describe, expect, it } from "vitest";
import {
  generateShareTokens,
  generateTokenWithHash,
  hashToken,
} from "./accessToken";

describe("accessToken", () => {
  it("generates a 64-character hex token", async () => {
    const { plaintext } = await generateTokenWithHash();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a SHA-256 hex hash of the token", async () => {
    const { plaintext, hash } = await generateTokenWithHash();
    const recomputed = await hashToken(plaintext);
    expect(hash).toBe(recomputed);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates distinct editor and view token pairs", async () => {
    const pair = await generateShareTokens();
    expect(pair.editorToken).not.toBe(pair.viewToken);
    expect(pair.editorHash).not.toBe(pair.viewHash);
    expect(pair.editorHash).toBe(await hashToken(pair.editorToken));
    expect(pair.viewHash).toBe(await hashToken(pair.viewToken));
  });

  it("does not expose the plaintext token from the hash", async () => {
    const { plaintext, hash } = await generateTokenWithHash();
    expect(hash).not.toContain(plaintext);
  });
});
