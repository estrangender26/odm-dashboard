import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

describe("Governance Milestone Regression Diagnostic Safety", () => {
  const scriptPath = join(process.cwd(), "scripts", "diagnose-milestone-regression.ts");

  it("should exit non-zero when LEGACY_MIGRATOR_MODE is missing", () => {
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    
    try {
      // Run script without LEGACY_MIGRATOR_MODE
      stdout = execSync(
        `npx tsx ${scriptPath} 2026-07-25`,
        {
          cwd: process.cwd(),
          env: { ...process.env, LEGACY_MIGRATOR_MODE: undefined },
          encoding: "utf-8",
          timeout: 10000,
        }
      );
    } catch (error: any) {
      exitCode = error.status || 1;
      stdout = error.stdout || "";
      stderr = error.stderr || "";
    }
    
    // Should exit with non-zero status
    expect(exitCode).not.toBe(0);
    
    // Should show fatal error message (check combined output)
    const combined = stdout + stderr;
    expect(combined).toContain("FATAL");
    expect(combined).toContain("LEGACY_MIGRATOR_MODE");
    expect(combined).toContain("required");
  });

  it("should exit non-zero when LEGACY_MIGRATOR_MODE is not '1'", () => {
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    
    try {
      // Run script with wrong LEGACY_MIGRATOR_MODE value
      stdout = execSync(
        `npx tsx ${scriptPath} 2026-07-25`,
        {
          cwd: process.cwd(),
          env: { ...process.env, LEGACY_MIGRATOR_MODE: "true" },
          encoding: "utf-8",
          timeout: 10000,
        }
      );
    } catch (error: any) {
      exitCode = error.status || 1;
      stdout = error.stdout || "";
      stderr = error.stderr || "";
    }
    
    // Should exit with non-zero status
    expect(exitCode).toBe(1);
    
    // Should show fatal error message
    const combined = stdout + stderr;
    expect(combined).toContain("FATAL");
    expect(combined).toContain("LEGACY_MIGRATOR_MODE");
  });

  it("should fail on invalid reporting date format", () => {
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    
    try {
      stdout = execSync(
        `npx tsx ${scriptPath} "invalid-date"`,
        {
          cwd: process.cwd(),
          env: { ...process.env, LEGACY_MIGRATOR_MODE: "1" },
          encoding: "utf-8",
          timeout: 10000,
        }
      );
    } catch (error: any) {
      exitCode = error.status || 1;
      stdout = error.stdout || "";
      stderr = error.stderr || "";
    }
    
    // Should exit with non-zero status
    expect(exitCode).not.toBe(0);
    
    // Should show invalid date message
    const combined = stdout + stderr;
    expect(combined).toContain("FATAL");
    expect(combined).toContain("Invalid");
    expect(combined).toContain("date");
  });

  it("should fail on malformed reporting date", () => {
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    
    try {
      stdout = execSync(
        `npx tsx ${scriptPath} "2026-99-99"`,
        {
          cwd: process.cwd(),
          env: { ...process.env, LEGACY_MIGRATOR_MODE: "1" },
          encoding: "utf-8",
          timeout: 10000,
        }
      );
    } catch (error: any) {
      exitCode = error.status || 1;
      stdout = error.stdout || "";
      stderr = error.stderr || "";
    }
    
    // Should exit with non-zero status
    expect(exitCode).not.toBe(0);
    
    // Should show invalid date message
    const combined = stdout + stderr;
    expect(combined).toContain("FATAL");
    expect(combined).toContain("Invalid");
    expect(combined).toContain("date");
  });

  it("should fail on calendar-invalid dates like 2026-02-30", () => {
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    
    try {
      stdout = execSync(
        `npx tsx ${scriptPath} "2026-02-30"`,
        {
          cwd: process.cwd(),
          env: { ...process.env, LEGACY_MIGRATOR_MODE: "1" },
          encoding: "utf-8",
          timeout: 10000,
        }
      );
    } catch (error: any) {
      exitCode = error.status || 1;
      stdout = error.stdout || "";
      stderr = error.stderr || "";
    }
    
    // Should exit with non-zero status
    expect(exitCode).not.toBe(0);
    
    // Should show invalid date message
    const combined = stdout + stderr;
    expect(combined).toContain("FATAL");
    expect(combined).toContain("Invalid");
    expect(combined).toContain("date");
  });
});
