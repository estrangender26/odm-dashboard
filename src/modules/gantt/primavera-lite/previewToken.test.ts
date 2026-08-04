import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPreviewToken,
  verifyPreviewToken,
  assertPreviewSecretConfigured,
  PreviewTokenException,
} from "./previewToken";

describe("previewToken", () => {
  beforeEach(() => {
    process.env.PRIMAVERA_LITE_PREVIEW_SECRET = "unit-test-secret";
    process.env.NODE_ENV = "test";
    delete process.env.RENDER;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a project archive preview token", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    const payload = await verifyPreviewToken(token, "archiveProject", "project-1", 5);
    expect(payload.slug).toBe("project-1");
    expect(payload.expectedRevision).toBe(5);
    expect(payload.entityId).toBeUndefined();
  });

  it("round-trips an activity archive preview token", async () => {
    const token = await createPreviewToken("archiveActivity", "project-1", 5, 42);
    const payload = await verifyPreviewToken(token, "archiveActivity", "project-1", 5, 42);
    expect(payload.entityId).toBe(42);
  });

  it("rejects a tampered token", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    const tampered = token.slice(0, -4) + "dead";
    await expect(verifyPreviewToken(tampered, "archiveProject", "project-1", 5)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    vi.advanceTimersByTime(6 * 60 * 1000);
    await expect(verifyPreviewToken(token, "archiveProject", "project-1", 5)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("rejects action mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveActivity", "project-1", 5)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("rejects slug mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveProject", "project-2", 5)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("rejects revision mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveProject", "project-1", 6)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("rejects entity id mismatch", async () => {
    const token = await createPreviewToken("archiveActivity", "project-1", 5, 42);
    await expect(verifyPreviewToken(token, "archiveActivity", "project-1", 5, 43)).rejects.toThrow(
      PreviewTokenException
    );
  });

  it("fails fast in production without a secret", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRIMAVERA_LITE_PREVIEW_SECRET;
    expect(() => assertPreviewSecretConfigured()).toThrow(PreviewTokenException);
    expect(() => assertPreviewSecretConfigured()).toThrow(/required in production/);
  });

  it("fails fast on Render without a secret", () => {
    process.env.RENDER = "true";
    delete process.env.PRIMAVERA_LITE_PREVIEW_SECRET;
    expect(() => assertPreviewSecretConfigured()).toThrow(PreviewTokenException);
  });

  it("does not fail in test mode without a secret", () => {
    process.env.NODE_ENV = "test";
    delete process.env.PRIMAVERA_LITE_PREVIEW_SECRET;
    expect(() => assertPreviewSecretConfigured()).not.toThrow();
  });

  it("does not fail when the secret is configured in production", () => {
    process.env.NODE_ENV = "production";
    process.env.PRIMAVERA_LITE_PREVIEW_SECRET = "prod-secret";
    expect(() => assertPreviewSecretConfigured()).not.toThrow();
  });
});
