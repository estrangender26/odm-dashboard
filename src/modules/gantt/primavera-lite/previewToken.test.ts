import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPreviewToken, verifyPreviewToken } from "./previewToken";

describe("previewToken", () => {
  beforeEach(() => {
    process.env.PRIMAVERA_LITE_PREVIEW_SECRET = "unit-test-secret";
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
    await expect(verifyPreviewToken(tampered, "archiveProject", "project-1", 5)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    vi.advanceTimersByTime(6 * 60 * 1000);
    await expect(verifyPreviewToken(token, "archiveProject", "project-1", 5)).rejects.toThrow("expired");
  });

  it("rejects action mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveActivity", "project-1", 5)).rejects.toThrow("action mismatch");
  });

  it("rejects slug mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveProject", "project-2", 5)).rejects.toThrow("slug mismatch");
  });

  it("rejects revision mismatch", async () => {
    const token = await createPreviewToken("archiveProject", "project-1", 5);
    await expect(verifyPreviewToken(token, "archiveProject", "project-1", 6)).rejects.toThrow("revision mismatch");
  });

  it("rejects entity id mismatch", async () => {
    const token = await createPreviewToken("archiveActivity", "project-1", 5, 42);
    await expect(verifyPreviewToken(token, "archiveActivity", "project-1", 5, 43)).rejects.toThrow("entity id mismatch");
  });
});
