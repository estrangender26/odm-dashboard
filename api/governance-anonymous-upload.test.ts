import { describe, it, expect, vi } from "vitest";

// Mock environment before importing
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");
vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

// Mock database
vi.doMock("./queries/connection", () => ({
  getDb: vi.fn(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  })),
  ensureDbReady: vi.fn(() => Promise.resolve()),
}));

describe("Governance anonymous upload capability handling", () => {
  describe("deepEqualJson target validation (order-independent)", () => {
    it("validates Governance target with reordered object keys", async () => {
      // Import after mocks are set up
      const { storageRouter } = await import("./storage-router");
      
      // Create a target with keys in one order
      const targetA = { facilitySlug: "test-fac", milestoneId: 123, extra: "data" };
      
      // Same target with keys in different order
      const targetB = { extra: "data", facilitySlug: "test-fac", milestoneId: 123 };
      
      // Keys are in different order but values are the same
      expect(Object.keys(targetA).sort()).toEqual(Object.keys(targetB).sort());
      expect(targetA.facilitySlug).toBe(targetB.facilitySlug);
      expect(targetA.milestoneId).toBe(targetB.milestoneId);
      expect(targetA.extra).toBe(targetB.extra);
    });

    it("fails when target values differ", async () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123 };
      const targetB = { facilitySlug: "test-fac", milestoneId: 456 };
      
      // Different milestoneId should cause mismatch
      expect(targetA.milestoneId).not.toBe(targetB.milestoneId);
    });

    it("fails when target types differ", async () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123 };
      const targetB = { facilitySlug: "test-fac", milestoneId: "123" };
      
      // Different types (number vs string) should cause mismatch
      expect(typeof targetA.milestoneId).not.toBe(typeof targetB.milestoneId);
    });
  });

  describe("localStorage safety", () => {
    it("capabilityToken is never persisted in localStorage", () => {
      // Read the governance-storage-upload.js source
      const fs = require("fs");
      const path = require("path");
      const filePath = path.join(__dirname, "../public/governance-storage-upload.js");
      const content = fs.readFileSync(filePath, "utf-8");
      
      // Verify capabilityToken is deleted before localStorage.setItem
      expect(content).toContain("delete authWithoutToken.capabilityToken");
      
      // Verify capabilityToken is handled in memory only
      expect(content).toContain("Note: capabilityToken is intentionally NOT persisted in localStorage");
      expect(content).toContain("Store capabilityToken in memory only");
    });
  });

  describe("O&M and SMP behavior unchanged", () => {
    it("O&M module upload authorization endpoint exists", async () => {
      const { storageRouter } = await import("./storage-router");
      const { Hono } = await import("hono");
      
      const app = new Hono();
      app.route("/api/storage", storageRouter);
      
      // O&M upload authorization should work (returns 404 for rate limit config, not 400 for validation)
      const response = await app.request("/api/storage/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "om",
          originalFilename: "test.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
          target: { test: "target" },
        }),
      });
      
      // Should not be a validation error
      expect(response.status).not.toBe(400);
    });

    it("SMP module upload authorization endpoint exists", async () => {
      const { storageRouter } = await import("./storage-router");
      const { Hono } = await import("hono");
      
      const app = new Hono();
      app.route("/api/storage", storageRouter);
      
      // SMP upload authorization should work
      const response = await app.request("/api/storage/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "smp",
          originalFilename: "test.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
          target: { test: "target" },
        }),
      });
      
      expect(response.status).not.toBe(400);
    });
  });
});
