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
 * Persistence-boundary guard (M2A baselines, M2B calendars).
 *
 * The port exists so that every consumer of an extracted cluster shares ONE
 * persistence implementation. These assertions make that structural rather than
 * aspirational: the package may DECLARE the contract but never implement it; ODM
 * must have exactly ONE adapter that WRITES the extracted tables; the ported
 * procedures must reach persistence only through that adapter; and an
 * unauthorized second implementation cannot hide behind an alias, a dynamic
 * import or raw SQL.
 */

const PERSISTENCE_PREFIX = `${PKG_PREFIX}src/persistence/`;
const ADAPTER = "api/primavera-lite-project-controls-store.ts";
const ROUTER = "api/primavera-lite-router.ts";
/** The canonical physical schema is not a persistence implementation. */
const SCHEMA_MODULE = "db/schema.ts";

/** Files the persistence contract folder may contain. Types and semantics only. */
const PERSISTENCE_FOLDER_INVENTORY = ["contract.ts", "index.ts"];

/**
 * The ONLY runtime values the persistence entry may export: pure encodings that
 * define how an opaque reference is spelled, not a store. Enumerated explicitly
 * so an implementation cannot sneak in as `export const …`.
 */
const PERSISTENCE_RUNTIME_EXPORTS = ["asProjectRevision", "internalProjectKey", "toProjectRef"];

/**
 * Tables extracted behind the port, with the files allowed to WRITE them.
 *
 * `gantt_calendars` has one documented, temporary exception: createProject mints
 * the project's default calendar before the project row can be locked, so it
 * still inserts that row directly (scope decision X — project creation is not
 * part of this extraction).
 */
const EXTRACTED_TABLES: Array<{
  camel: string;
  snake: string;
  writers: string[];
  referencers: string[];
}> = [
  { camel: "ganttBaselines", snake: "gantt_baselines", writers: [ADAPTER], referencers: [ADAPTER] },
  { camel: "ganttBaselineActivities", snake: "gantt_baseline_activities", writers: [ADAPTER], referencers: [ADAPTER] },
  {
    camel: "ganttCalendars",
    snake: "gantt_calendars",
    writers: [ADAPTER, ROUTER],
    // The router keeps BOUNDED READS for aggregates that are not ported yet:
    // createProject (mints the default calendar), load, runSchedule,
    // requireProjectCalendar (activity + default-calendar ownership checks) and
    // the injected resolveActivityCalendar primitive.
    referencers: [ADAPTER, ROUTER],
  },
  {
    camel: "ganttCalendarExceptions",
    snake: "gantt_calendar_exceptions",
    writers: [ADAPTER],
    // Same bounded reads as gantt_calendars; no router WRITES remain.
    referencers: [ADAPTER, ROUTER],
  },
];

/** Procedures that must obtain persistence ONLY through the port. */
const PORTED_PROCEDURES = [
  "captureBaseline",
  "listBaselines",
  "compareBaseline",
  "createCalendar",
  "updateCalendar",
  "createCalendarException",
  "updateCalendarException",
  "deleteCalendarException",
];

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

/** A Drizzle write or a raw SQL write statement against a table. */
function writePatterns(camel: string, snake: string): RegExp[] {
  return [
    new RegExp(`\\.(?:insert|update|delete)\\(\\s*${camel}\\b`),
    new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+["'\`]?${snake}\\b`, "i"),
  ];
}

/** A Drizzle read or a raw SQL read statement against a table. */
function readPatterns(camel: string, snake: string): RegExp[] {
  return [
    new RegExp(`\\.from\\(\\s*${camel}\\b`),
    new RegExp(`\\b(?:FROM|JOIN)\\s+["'\`]?${snake}\\b`, "i"),
  ];
}

/** Production (non-test) repository files matching any of the patterns. */
function productionFilesMatching(patterns: RegExp[]): string[] {
  return FILES.filter((f) => {
    const r = rel(f);
    if (/\.(test|spec)\.tsx?$/.test(r)) return false;
    const source = readFileSync(f, "utf8");
    return patterns.some((p) => p.test(source));
  }).map(rel);
}

/** Procedure name -> its source body, for every tRPC procedure in the router. */
function procedureBodies(): Map<string, string> {
  const lines = readFileSync(path.join(REPO, ROUTER), "utf8").split("\n");
  const starts = lines
    .map((l, i) => ({ i, m: /^ {2}([a-zA-Z0-9_]+): (?:publicQuery|authedQuery|adminQuery)/.exec(l) }))
    .filter((x) => x.m) as Array<{ i: number; m: RegExpExecArray }>;
  const bodies = new Map<string, string>();
  starts.forEach((entry, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].i : lines.length;
    bodies.set(entry.m[1], lines.slice(entry.i, end).join("\n"));
  });
  return bodies;
}

/** Direct persistence references that a ported procedure must not contain. */
function directPersistenceRefs(body: string): string[] {
  const refs: string[] = [];
  const patterns: RegExp[] = [
    /\bdb\./,
    /\btx\./,
    /(?<!scope\.)\blockProject\s*\(/,
    /(?<!scope\.)\bbumpProjectRevision\s*\(/,
    /(?<!scope\.)\binsertEvent\s*\(/,
    /requireProjectCalendar\s*\(/,
    /applyRateLimit\s*\(/,
  ];
  for (const entry of EXTRACTED_TABLES) {
    patterns.push(new RegExp(`\\b${entry.camel}\\b`), new RegExp(`\\b${entry.snake}\\b`, "i"));
  }
  for (const p of patterns) for (const m of body.match(p) ? [p] : []) refs.push(String(m));
  return refs;
}

describe("project-controls persistence boundary", () => {
  it("declares the persistence contract inside the package", () => {
    const contractPath = path.join(REPO, PERSISTENCE_PREFIX, "contract.ts");
    expect(existsSync(contractPath), "the package must declare the persistence contract").toBe(true);

    const source = readFileSync(contractPath, "utf8");
    for (const declaration of [
      "interface ProjectControlsStore",
      "interface ProjectReadScope",
      "interface ProjectWriteScope",
      "interface ProjectWriteGate",
      "interface CalendarRecord",
      "interface CalendarExceptionRecord",
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
    ).toEqual([...PERSISTENCE_RUNTIME_EXPORTS].sort());
  });

  it("declares no runtime implementation in the persistence contract source", () => {
    // A store could otherwise evade the entry-point assertion by being declared
    // (and exported) directly in contract.ts.
    const folder = path.join(REPO, PERSISTENCE_PREFIX);
    const declared: string[] = [];
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(folder, file), "utf8").replace(/\/\/[^\n]*/g, "");
      const re = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) declared.push(m[1]);
    }
    expect(
      [...new Set(declared)].sort(),
      "the persistence contract may declare only the sanctioned pure encodings as runtime values"
    ).toEqual([...PERSISTENCE_RUNTIME_EXPORTS].sort());
  });

  it("routes every WRITE to an extracted table through the ONE ODM adapter", () => {
    const offenders: string[] = [];
    for (const entry of EXTRACTED_TABLES) {
      const writers = productionFilesMatching(writePatterns(entry.camel, entry.snake)).filter(
        (f) => f !== SCHEMA_MODULE
      );
      const unexpected = writers.filter((f) => !entry.writers.includes(f));
      if (unexpected.length > 0) {
        offenders.push(`${entry.snake}: ${unexpected.join(", ")}`);
      }
    }
    expect(
      offenders,
      "an extracted table may only be written by the ODM adapter (plus the one documented createProject exception for gantt_calendars)"
    ).toEqual([]);
  });

  it("routes every baseline and calendar-exception write through the adapter alone", () => {
    // gantt_calendars has the documented createProject exception; these three do not.
    const exclusive = EXTRACTED_TABLES.filter((t) => t.snake !== "gantt_calendars");
    for (const entry of exclusive) {
      const writers = productionFilesMatching(writePatterns(entry.camel, entry.snake)).filter(
        (f) => f !== SCHEMA_MODULE
      );
      expect(writers, `${entry.snake} writes must be owned by the adapter alone`).toEqual([ADAPTER]);
    }
  });

  it("keeps every reference to an extracted table inside its documented owners", () => {
    // Layered on top of the write assertions: no NEW production file may even
    // import or alias an extracted table, which is how a second persistence path
    // would start. Raw SQL has no identifier, so it is covered separately below.
    const offenders: string[] = [];
    for (const entry of EXTRACTED_TABLES) {
      const referencers = productionFilesMatching([new RegExp(`\\b${entry.camel}\\b`)])
        .filter((f) => f !== SCHEMA_MODULE)
        .sort();
      const unexpected = referencers.filter((f) => !entry.referencers.includes(f));
      if (unexpected.length > 0) offenders.push(`${entry.snake}: ${unexpected.join(", ")}`);
    }
    expect(
      offenders,
      "an extracted table may only be referenced by the adapter and its documented bounded readers"
    ).toEqual([]);
  });

  it("detects raw-SQL access to extracted tables that bypasses the adapter", () => {
    // The Adapter is allowed to use raw SQL; nothing else may write these tables
    // with it, and no file may reach them by raw SQL while claiming to be a
    // second implementation.
    const offenders: string[] = [];
    for (const entry of EXTRACTED_TABLES) {
      const rawWrite = new RegExp(
        `\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+["'\`]?${entry.snake}\\b`,
        "i"
      );
      for (const f of productionFilesMatching([rawWrite])) {
        if (f !== ADAPTER && f !== SCHEMA_MODULE && !entry.writers.includes(f)) {
          offenders.push(`${f} -> ${entry.snake} (raw SQL write)`);
        }
      }
    }
    expect(
      offenders,
      "raw SQL must not become a second write path to an extracted table"
    ).toEqual([]);
  });

  it("keeps the createProject calendar write as the only documented exception, inside createProject", () => {
    const bodies = procedureBodies();
    const outsideCreateProject: string[] = [];
    for (const [name, body] of bodies) {
      if (name === "createProject") continue;
      for (const entry of EXTRACTED_TABLES) {
        if (writePatterns(entry.camel, entry.snake).some((p) => p.test(body))) {
          outsideCreateProject.push(`${name} -> ${entry.snake}`);
        }
      }
    }
    expect(
      outsideCreateProject,
      "no procedure other than createProject may write an extracted table directly"
    ).toEqual([]);

    const createProject = bodies.get("createProject") ?? "";
    expect(
      writePatterns("ganttCalendars", "gantt_calendars").some((p) => p.test(createProject)),
      "the documented createProject exception is expected to still insert its default calendar"
    ).toBe(true);
  });

  it("keeps the adapter in ODM and the extracted tables out of the package", () => {
    expect(existsSync(path.join(REPO, ADAPTER)), "the ODM project-controls adapter must exist").toBe(true);
    const inPackage: string[] = [];
    for (const entry of EXTRACTED_TABLES) {
      const hits = productionFilesMatching([
        ...writePatterns(entry.camel, entry.snake),
        ...readPatterns(entry.camel, entry.snake),
      ]).filter((f) => f.startsWith(PKG_PREFIX));
      if (hits.length > 0) inPackage.push(`${entry.snake}: ${hits.join(", ")}`);
    }
    expect(inPackage, "the package declares the port; it must never own the tables").toEqual([]);
  });

  it("has exactly one production adapter instance in the repository", () => {
    const constructors = productionFilesMatching([/createPrimaveraLiteProjectControlsStore\s*\(/]).sort();
    expect(
      constructors,
      "one adapter factory and one construction site: a second store would be a second implementation"
    ).toEqual([ADAPTER, ROUTER].sort());
  });

  it("proves the adapter implements the port through the public subpath only", () => {
    const adapter = readFileSync(path.join(REPO, ADAPTER), "utf8");
    expect(importSpecifiers(adapter)).toContain("@lihok/project-controls/persistence");
    expect(adapter).toContain("ProjectControlsStore");
    expect(importSpecifiers(adapter)).not.toContain("@lihok/project-controls/persistence/contract");
  });

  it("proves every ported procedure reaches persistence only through the port", () => {
    const bodies = procedureBodies();
    const problems: string[] = [];
    for (const name of PORTED_PROCEDURES) {
      const body = bodies.get(name);
      if (!body) {
        problems.push(`${name}: procedure not found`);
        continue;
      }
      if (!body.includes("projectControlsStore.")) {
        problems.push(`${name}: does not use the persistence store`);
      }
      const refs = directPersistenceRefs(body);
      if (refs.length > 0) problems.push(`${name}: direct persistence (${refs.join(", ")})`);
    }
    expect(
      problems,
      "a ported procedure must obtain all persistence through the port — a decorative port would fail here"
    ).toEqual([]);
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
