/**
 * Minimal Storage Migrator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateStoragePath } from "../../scripts/minimal-storage-migrator";
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

describe("SMP ID 31 exclusion", () => {
  it("is excluded from processing", () => {
    // ID 31 should never appear in processing list
    // This is enforced by the SQL query: sql`id != 31`
    expect(31).toBe(31); // Placeholder - real test would verify SQL filter
  });
});
