import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Anti-fork guard for the @lihok/project-controls extraction (M1).
 *
 * It fails if ODM grows a second implementation of a package-owned algorithm,
 * if the package starts depending on ODM, or if a consumer reaches past the
 * public entry point. Deliberately small and high-signal: it checks canonical
 * declarations, the frozen ODM-side inventory, and the import boundary — not
 * free-text patterns.
 */

const REPO = path.resolve(import.meta.dirname, "../..");
const PKG_DIR = path.join(REPO, "packages/project-controls");
const PKG_PREFIX = "packages/project-controls/";
const SCAN_DIRS = ["src", "api", "db", "scripts", "contracts", "packages"];
const EXT = new Set([".ts", ".tsx"]);

/** Authoritative algorithms: exactly ONE declaration, inside the package. */
const CANONICAL_SYMBOLS = [
  "runScheduleEngine",
  "topologicalSort",
  "addWorkingDays",
  "subWorkingDays",
  "countWorkingDays",
  "getWorkingDuration",
  "dateToCalendarDay",
  "calendarDayToDate",
  "resolveDefaultCalendar",
  "normalizeWorkingDays",
  "validateWorkingDays",
  "workingDaysEqual",
  "calendarAffectsActiveSchedule",
  "deriveProgressState",
  "resolveProgress",
  "deriveRemainingDuration",
  "autoActualFinishFromDataDate",
  "percentAfterClearingActualFinish",
  "summarizeStatusing",
  "activityLifecycle",
  "forecastRemainingDays",
  "compareActivityToBaseline",
  "buildProjectComparison",
  "currentDurationDays",
  "calendarDayVariance",
  "durationDayVariance",
  "isCpmDrivingEvent",
  "isScheduleOutOfDate",
];

/** The six modules that MOVED. Their old ODM paths must not exist (no shims). */
const MOVED_MODULE_PATHS = [
  "src/modules/gantt/primavera-lite/schedulingEngine.ts",
  "src/modules/gantt/primavera-lite/progressModel.ts",
  "src/modules/gantt/primavera-lite/statusingModel.ts",
  "src/modules/gantt/primavera-lite/baselineVariance.ts",
  "src/modules/gantt/primavera-lite/calendarModel.ts",
  "src/modules/gantt/primavera-lite/scheduleStaleness.ts",
];

/**
 * Frozen inventory of what legitimately REMAINS in the ODM primavera-lite
 * folder: React panels, view/session models, and their tests. Adding a file
 * here fails this guard on purpose — new domain code belongs in the package,
 * so the decision has to be explicit rather than accidental.
 */
const ODM_FOLDER_INVENTORY = [
  "ActivityGrid.test.tsx", "ActivityGrid.tsx",
  "ActivityProgressPanel.test.tsx", "ActivityProgressPanel.tsx",
  "BaselinePanel.test.tsx", "BaselinePanel.tsx",
  "CalendarPanel.test.tsx", "CalendarPanel.tsx",
  "DependencyPanel.restore.test.tsx", "DependencyPanel.test.ts", "DependencyPanel.tsx",
  "StatusingPanel.test.tsx", "StatusingPanel.tsx",
  "Timeline.test.ts", "Timeline.tsx",
  "WbsTree.test.tsx", "WbsTree.tsx",
  "activityGridModel.test.ts", "activityGridModel.ts",
  "dependencyModel.test.ts", "dependencyModel.ts",
  "pageState.test.ts", "pageState.ts",
  "previewToken.test.ts", "previewToken.ts",
  "timelineModel.test.ts", "timelineModel.ts",
  "wbsTreeModel.test.ts", "wbsTreeModel.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(entry))) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(path.join(REPO, d)));
const rel = (f: string) => path.relative(REPO, f).split(path.sep).join("/");

/** Locate `export [declare] function|const|interface|type <symbol>` declarations. */
function declaringFiles(symbol: string): string[] {
  const re = new RegExp(
    `^\\s*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|const|interface|type|class)\\s+${symbol}\\b`,
    "m"
  );
  return FILES.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel);
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

describe("project-controls extraction boundary", () => {
  it("declares every canonical algorithm exactly once, inside the package", () => {
    const offenders: string[] = [];
    for (const symbol of CANONICAL_SYMBOLS) {
      const files = declaringFiles(symbol);
      const outside = files.filter((f) => !f.startsWith(PKG_PREFIX));
      if (files.length !== 1 || outside.length > 0) {
        offenders.push(`${symbol}: ${files.length} declaration(s) -> ${files.join(", ") || "none"}`);
      }
    }
    expect(offenders, `canonical algorithms must have exactly one authoritative declaration in ${PKG_PREFIX}`).toEqual([]);
  });

  it("left no compatibility shim (or copy) at the moved module paths", () => {
    const present = MOVED_MODULE_PATHS.filter((p) => FILES.map(rel).includes(p));
    expect(present, "moved modules must not exist in ODM — the extraction was a move, not a copy").toEqual([]);
  });

  it("keeps the ODM primavera-lite folder to the frozen view/session inventory", () => {
    const folder = path.join(REPO, "src/modules/gantt/primavera-lite");
    const actual = readdirSync(folder).sort();
    expect(
      actual,
      "new files in the ODM primavera-lite folder need an explicit decision: domain code belongs in @lihok/project-controls"
    ).toEqual([...ODM_FOLDER_INVENTORY].sort());
  });

  it("keeps the package free of ODM, React, tRPC and Drizzle imports", () => {
    const pkgFiles = FILES.filter((f) => rel(f).startsWith(PKG_PREFIX));
    expect(pkgFiles.length).toBeGreaterThan(10);
    const violations: string[] = [];
    for (const f of pkgFiles) {
      for (const spec of importSpecifiers(readFileSync(f, "utf8"))) {
        const ok = spec.startsWith("./") || spec.startsWith("../") || spec === "vitest" || spec.startsWith("node:");
        if (!ok) violations.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(violations, "the package must not depend on ODM, React, tRPC or Drizzle").toEqual([]);
  });

  it("makes ODM consume the package through its public entry points only", () => {
    const allowed = new Set([
      "@lihok/project-controls",
      "@lihok/project-controls/persistence",
      "@lihok/project-controls/testing",
    ]);
    const violations: string[] = [];
    for (const f of FILES) {
      const r = rel(f);
      if (r.startsWith(PKG_PREFIX)) continue;
      const isTest = /\.(test|spec)\.tsx?$/.test(r);
      for (const spec of importSpecifiers(readFileSync(f, "utf8"))) {
        if (!spec.startsWith("@lihok/project-controls")) continue;
        if (!allowed.has(spec)) violations.push(`${r} -> ${spec} (deep import)`);
        if (spec.endsWith("/testing") && !isTest) violations.push(`${r} -> ${spec} (testing entry outside a test file)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares the package manifest and export contract", () => {
    // The missing manifest was a review finding: the package identity must be
    // declared, not merely implied by path aliases.
    const manifestPath = path.join(PKG_DIR, "package.json");
    expect(existsSync(manifestPath), "packages/project-controls/package.json must exist").toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      version?: string;
      private?: boolean;
      type?: string;
      exports?: Record<string, string>;
      dependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };

    expect(manifest.name).toBe("@lihok/project-controls");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.exports?.["."]).toBe("./src/index.ts");
    expect(manifest.exports?.["./persistence"]).toBe("./src/persistence/index.ts");
    expect(manifest.exports?.["./testing"]).toBe("./src/testing.ts");

    // Zero runtime dependencies: the package is pure TypeScript.
    const runtimeDeps = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };
    expect(Object.keys(runtimeDeps)).toEqual([]);

    // Every declared export target must actually exist in the package.
    for (const target of Object.values(manifest.exports ?? {})) {
      expect(existsSync(path.join(PKG_DIR, target)), `export target ${target} must exist`).toBe(true);
    }
  });

  it("proves ODM actually consumes the package (guards against a vacuous boundary)", () => {
    const consumers = FILES.filter((f) => !rel(f).startsWith(PKG_PREFIX))
      .filter((f) => importSpecifiers(readFileSync(f, "utf8")).some((s) => s.startsWith("@lihok/project-controls")));
    expect(consumers.length).toBeGreaterThanOrEqual(8);
  });
});

/**
 * M2A persistence-boundary guard.
 *
 * The port exists so that every consumer of the baseline cluster shares ONE
 * persistence implementation. These assertions make that structural rather than
 * aspirational: the package may DECLARE the contract but never implement it, ODM
 * must have exactly one baseline adapter, and no second path to the baseline
 * tables may appear.
 */

const PERSISTENCE_PREFIX = `${PKG_PREFIX}src/persistence/`;
const BASELINE_ADAPTER = "api/primavera-lite-baseline-store.ts";
const ROUTER = "api/primavera-lite-router.ts";
/** The canonical physical schema is not a persistence implementation. */
const SCHEMA_MODULE = "db/schema.ts";

/** Files the persistence contract folder may contain. Types and semantics only. */
const PERSISTENCE_FOLDER_INVENTORY = ["contract.ts", "index.ts"];

/** The ONLY runtime values the persistence entry may export (pure encodings). */
const PERSISTENCE_VALUE_EXPORTS = ["asProjectRevision", "internalProjectKey", "toProjectRef"];

/** The baseline cluster's tables. */
const BASELINE_TABLES = ["ganttBaselines", "ganttBaselineActivities"];

function filesReferencingBaselineTables(): string[] {
  return FILES.filter((f) => {
    const source = readFileSync(f, "utf8");
    return BASELINE_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(source));
  }).map(rel);
}

/** Names a module exports as VALUES — `export type { … }` is deliberately excluded. */
function valueExports(source: string): string[] {
  const withoutComments = source.replace(/\/\/[^\n]*/g, "");
  const names: string[] = [];
  const re = /(?:^|\n)\s*export\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments))) {
    for (const raw of m[1].split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const [local, exported] = entry.split(/\s+as\s+/).map((s) => s.trim());
      names.push(exported || local);
    }
  }
  return names;
}

describe("project-controls persistence boundary (M2A)", () => {
  it("declares the persistence contract inside the package", () => {
    const contractPath = path.join(REPO, PERSISTENCE_PREFIX, "contract.ts");
    expect(existsSync(contractPath), "the package must declare the persistence contract").toBe(true);

    const source = readFileSync(contractPath, "utf8");
    for (const declaration of [
      "interface ProjectControlsStore",
      "interface ProjectReadScope",
      "interface ProjectWriteScope",
      "interface ProjectWriteGate",
      "type ProjectRef",
      "type ProjectRevision",
      "type RowRevision",
    ]) {
      expect(source, `the persistence contract must declare ${declaration}`).toContain(declaration);
    }
  });

  it("keeps the persistence folder to contract files only — no implementation", () => {
    const folder = path.join(REPO, PERSISTENCE_PREFIX);
    // Test files are colocated by package convention and are never published as
    // an implementation; everything else in this folder must be contract only.
    const nonTest = readdirSync(folder)
      .filter((entry) => !/\.(test|spec)\.tsx?$/.test(entry))
      .sort();
    expect(
      nonTest,
      "a store implementation inside the package would recreate the fork the port exists to prevent"
    ).toEqual([...PERSISTENCE_FOLDER_INVENTORY].sort());
  });

  it("exports the persistence contract and no persistence implementation", () => {
    const entry = readFileSync(path.join(REPO, PERSISTENCE_PREFIX, "index.ts"), "utf8");
    expect(
      valueExports(entry).sort(),
      "the persistence entry may export contract semantics only (pure encodings), never a store"
    ).toEqual([...PERSISTENCE_VALUE_EXPORTS].sort());
  });

  it("routes every baseline table access through the ONE ODM baseline adapter", () => {
    const owners = filesReferencingBaselineTables().filter(
      (f) => f !== SCHEMA_MODULE && !/\.(test|spec)\.tsx?$/.test(f)
    );
    expect(
      owners,
      "baseline persistence must have exactly one owner: the ODM adapter (test fakes and the canonical schema excluded)"
    ).toEqual([BASELINE_ADAPTER]);
  });

  it("keeps the baseline adapter in ODM and the baseline tables out of the package", () => {
    expect(existsSync(path.join(REPO, BASELINE_ADAPTER)), "the ODM baseline adapter must exist").toBe(true);
    expect(
      filesReferencingBaselineTables().filter((f) => f.startsWith(PKG_PREFIX)),
      "the package declares the port; it must never own the tables"
    ).toEqual([]);
  });

  it("proves the adapter implements the port through the public subpath only", () => {
    const adapter = readFileSync(path.join(REPO, BASELINE_ADAPTER), "utf8");
    expect(importSpecifiers(adapter)).toContain("@lihok/project-controls/persistence");
    expect(adapter).toContain("ProjectControlsStore");
  });

  it("proves the baseline procedures go through the adapter (no decorative port)", () => {
    const router = readFileSync(path.join(REPO, ROUTER), "utf8");
    expect(importSpecifiers(router)).toContain("./primavera-lite-baseline-store");
    const uses = router.match(/baselineStore\./g) ?? [];
    expect(
      uses.length,
      "captureBaseline, listBaselines and compareBaseline must each reach persistence through the store"
    ).toBeGreaterThanOrEqual(3);
  });

  it("never reaches into the persistence contract by path", () => {
    // This guard necessarily contains the path it forbids, so it excludes itself.
    const self = "src/lib/project-controls-boundary.test.ts";
    const offenders = FILES.map(rel)
      .filter((r) => !r.startsWith(PKG_PREFIX) && r !== self)
      .filter((r) => readFileSync(path.join(REPO, r), "utf8").includes("project-controls/src/persistence"));
    expect(
      offenders,
      "import the public subpath @lihok/project-controls/persistence, never a path inside the package"
    ).toEqual([]);
  });
});
