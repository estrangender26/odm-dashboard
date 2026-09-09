import { describe, expect, it } from "vitest";
import type { ReadoutLine } from "../executive-presentations/framework/readoutText";
import {
  buildExecutiveReadoutKpis,
  buildExecutiveReadoutLines,
  classifyExecutiveKpi,
  formatExecutiveKpiValue,
} from "./executiveReadout";
import type { ExecutiveReadoutInput } from "./executiveReadout";

type LinesLike = ReadoutLine[];

function sections(lines: LinesLike): { headings: string[]; bullets: string[] } {
  const headings: string[] = [];
  const bullets: string[] = [];
  for (const line of lines) {
    if (line.kind === "heading") headings.push(line.text);
    else bullets.push(line.text);
  }
  return { headings, bullets };
}

const AUG: Record<string, Partial<Record<string, number | null>>> = {
  "AMD-EZ": {
    pmCompliance: 98.38115588115588,
    budgetSpend: 95.71630789642415,
    pmCmWorkOrderRatio: 84.3607579755337,
    pmCmCostRatio: 75.53920623827713,
    mttrDays: 85.86146682188591,
    facilityUptime: 100,
  },
  CWC: {
    pmCompliance: 100,
    budgetSpend: 80.49344184694941,
    pmCmWorkOrderRatio: 99.73262032085562,
    pmCmCostRatio: 83.3605116719124,
    mttrDays: 2.269393939393939,
    facilityUptime: 99.89068849702157,
  },
  LARC: {
    pmCompliance: 100,
    budgetSpend: 22.47522765598651,
    pmCmWorkOrderRatio: 93.93939393939394,
    pmCmCostRatio: 58.282718616186756,
    mttrDays: 0.4633333333333333,
    facilityUptime: 99.90764433849559,
  },
  TWCI: {
    pmCompliance: 62.30590974087538,
    budgetSpend: 65.61519197829718,
    pmCmWorkOrderRatio: 89.77272727272727,
    pmCmCostRatio: 67.48500497765745,
    mttrDays: 42.25,
    facilityUptime: 99.07851022465438,
  },
};

const NOTES: Record<string, string> = {
  CWC: "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
  LARC:
    "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)",
  TWCI:
    "PM Compliance: Other PMS activities such as Painting works, Service vehicle pms was deffered to September due to materials and request was still on going thru S4.; Budget Spend: Only low value procurement was disbursed for month of August, other preventive maintenance does not require expenses such as cleaning and facility upkeeping.; PM CM Cost: PM(Sedimentation Cleaning,Flucculation tank cleaning,AR Lagoon desilting,Chlorination system pms, 2 dmf tank cleaning and disinfection, 1 dredger pms, grasscutting )\nCM(Additional long arm for AR Lagoon recovery, 41KVA Assessment and Repair) no expenses on repairs\nCM(Well 2 Transmission line pole repair); MTTR: Well 2 was down for 2 days due to damage transmission line pole; Facility Uptime: No downtime but August 21-26 was low production.",
};

function input(bu: string): ExecutiveReadoutInput {
  return {
    businessUnit: bu,
    monthLabel: "August 2026",
    reportingMonth: 8,
    notes: NOTES[bu] ?? null,
    situation: null,
    values: AUG[bu] as Record<string, number | null>,
  };
}

describe("source-bound EXECUTIVE COMMENTARY (no Management Assessment)", () => {
  it("has exactly the EXECUTIVE COMMENTARY heading and never MANAGEMENT ASSESSMENT", () => {
    for (const bu of ["AMD-EZ", "CWC", "LARC", "TWCI"]) {
      const { headings } = sections(buildExecutiveReadoutLines(input(bu)));
      expect(headings).toEqual(["EXECUTIVE COMMENTARY"]);
    }
  });

  it("emits at most 3 exception bullets", () => {
    for (const bu of ["AMD-EZ", "CWC", "LARC", "TWCI"]) {
      const { bullets } = sections(buildExecutiveReadoutLines(input(bu)));
      expect(bullets.length).toBeLessThanOrEqual(3);
    }
  });

  it("AMD-EZ (blank notes) never invents an explanation or management language", () => {
    const { bullets } = sections(buildExecutiveReadoutLines(input("AMD-EZ")));
    const all = bullets.join(" ");
    // New rule: no authoritative explanation => NO Executive Commentary bullet.
    expect(bullets).toEqual([]);
    expect(all).toBe("");
    expect(all).not.toMatch(/Validate|MTTR|non-critical|Prioritize|Review|Monitor/i);
    expect(all).not.toMatch(/PM:CM work orders \(84\.4%\)/);
  });

  it("CWC bullet explains Budget Spend from the submitted note only", () => {
    const { bullets } = sections(buildExecutiveReadoutLines(input("CWC")));
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets[0]).toContain("Budget Spend");
    expect(bullets[0]).toContain("media replacement");
    expect(bullets[0]).not.toContain("Budget Spend (80.49%)");
    expect(bullets.join(" ")).not.toContain("management");
    expect(bullets.join(" ")).not.toContain("Monitor");
  });

  it("TWCI commentary is source-bound and compressed", () => {
    const { bullets } = sections(buildExecutiveReadoutLines(input("TWCI")));
    const all = bullets.join("\n");
    expect(bullets.length).toBeLessThanOrEqual(3);
    expect(all.toLowerCase()).toMatch(/deffered|deferred|deferr/);
    expect(all).toContain("materials");
    // Each bullet is compressed to <= 150 chars; the whole readout is shorter
    // than the source note.
    for (const bullet of bullets) expect(bullet.length).toBeLessThanOrEqual(205);
    expect(all.length).toBeLessThan(NOTES.TWCI.length);
  });

  it("TWCI notes can explain up to three below-target KPIs; no invented wording", () => {
    const { bullets } = sections(buildExecutiveReadoutLines(input("TWCI")));
    const all = bullets.join(" ");
    expect(all).not.toContain("Priority is");
    expect(all).not.toContain("Management should");
    expect(all).not.toContain("Validate");
    expect(all).not.toContain("Strengthen");
  });

  it("a KPI that meets target is never mentioned", () => {
    // CWC PM Compliance (100%) is not below target.
    const { bullets } = sections(buildExecutiveReadoutLines(input("CWC")));
    expect(bullets.join(" ")).not.toContain("PM Compliance");
  });

  it("determinism: identical inputs give identical output", () => {
    const a = sections(buildExecutiveReadoutLines(input("TWCI")));
    const b = sections(buildExecutiveReadoutLines(input("TWCI")));
    expect(a).toEqual(b);
  });
});

describe("classifier and formatter sanity", () => {
  it("formats values deterministically", () => {
    expect(formatExecutiveKpiValue("pmCompliance", 62.3059)).toBe("62.31%");
    expect(formatExecutiveKpiValue("budgetSpend", 65.6151)).toBe("65.62%");
    expect(formatExecutiveKpiValue("pmCmCostRatio", 67.485)).toBe("67.5%");
    expect(formatExecutiveKpiValue("mttrDays", 42.25)).toBe("42.25 days");
  });

  it("classifies with the authoritative thresholds only (MTTR has no band)", () => {
    expect(classifyExecutiveKpi("pmCompliance", 62.3)).toBe("red");
    expect(classifyExecutiveKpi("pmCompliance", 95)).toBe("amber");
    expect(classifyExecutiveKpi("budgetSpend", 80)).toBe("red");
    expect(classifyExecutiveKpi("facilityUptime", 99.95)).toBe("amber");
    expect(classifyExecutiveKpi("mttrDays", 42.25)).toBe("green");
    expect(classifyExecutiveKpi("mttrDays", null)).toBe("missing");
    const kpis = buildExecutiveReadoutKpis(AUG["AMD-EZ"] as Record<string, number | null>);
    expect(kpis.find((k) => k.key === "pmCmWorkOrderRatio")!.status).toBe("amber");
    expect(kpis.find((k) => k.key === "mttrDays")!.status).toBe("green");
  });
});

describe("per-KPI Notes + Situation search, red-before-amber, source-bound", () => {
  function mk(overrides: Partial<ExecutiveReadoutInput>): ExecutiveReadoutInput {
    return {
      businessUnit: "TEST",
      monthLabel: "August 2026",
      reportingMonth: 8,
      notes: null,
      situation: null,
      values: {
        pmCompliance: 100,
        budgetSpend: 100,
        pmCmWorkOrderRatio: 90,
        pmCmCostRatio: 85,
        mttrDays: 5,
        facilityUptime: 100,
      },
      ...overrides,
    };
  }

  it("A: Notes explains one failed KPI and Situation explains another - BOTH bullets appear", () => {
    const lines = buildExecutiveReadoutLines(
      mk({
        values: { ...mk({}).values, budgetSpend: 80, facilityUptime: 98.5 },
        notes: "Budget Spend: Replacement of filters",
        situation: "Facility Uptime: Genset breakdown affected uptime",
      })
    );
    const bullets = sections(lines).bullets;
    expect(bullets.find((b) => b.startsWith("Budget Spend"))).toBeTruthy();
    expect(bullets.find((b) => b.startsWith("Facility Uptime"))).toBeTruthy();
    expect(bullets.find((b) => b.startsWith("Budget Spend"))).toContain("filters");
    expect(bullets.find((b) => b.startsWith("Facility Uptime"))).toContain("Genset");
  });

  it("B: a Situation clause unrelated to any failed KPI is never attached generically", () => {
    const lines = buildExecutiveReadoutLines(
      mk({
        values: { ...mk({}).values, pmCompliance: 85 }, // PM Compliance red
        notes: null,
        situation: "Staff safety training was completed for all teams.",
      })
    );
    const bullets = sections(lines).bullets;
    expect(bullets.join(" ")).not.toContain("Staff safety training");
    expect(bullets.join(" ")).not.toMatch(/^The BU situation note/i);
  });

  it("C: red exceptions are selected before amber when more than three KPIs miss target", () => {
    const redKeys = ["pmCompliance", "budgetSpend", "pmCmWorkOrderRatio"];
    const amberKey = "pmCmCostRatio";
    const values: Record<string, number | null> = {
      pmCompliance: 60,
      budgetSpend: 60,
      pmCmWorkOrderRatio: 60,
      pmCmCostRatio: 60,
      mttrDays: 5,
      facilityUptime: 99.4, // amber
    };
    const notes =
      "PM Compliance: compliance note; Budget Spend: budget note; PM:CM work orders: wo note; PM:CM cost: cost note; Facility Uptime: fu note";
    const bullets = sections(
      buildExecutiveReadoutLines(mk({ values, notes }))
    ).bullets;
    expect(bullets.length).toBeLessThanOrEqual(3);
    // All three red KPIs fill the 3-bullet cap before any amber KPI appears.
    expect(bullets[0].startsWith("PM Compliance")).toBe(true);
    expect(bullets[1].startsWith("Budget Spend")).toBe(true);
    expect(bullets[2].startsWith("PM:CM work orders")).toBe(true);
    expect(bullets.some((b) => b.startsWith("PM:CM cost"))).toBe(false);
    expect(bullets.some((b) => b.startsWith("Facility Uptime"))).toBe(false);
    expect(redKeys.every((k) => k !== amberKey)).toBe(true);
  });

  it("D: stable KPI order is preserved within the same status", () => {
    const values: Record<string, number | null> = {
      pmCompliance: 60,
      budgetSpend: 60,
      pmCmWorkOrderRatio: 95,
      pmCmCostRatio: 95,
      mttrDays: 5,
      facilityUptime: 100,
    };
    const notes = "PM Compliance: a; Budget Spend: b; PM:CM work orders: c; PM:CM cost: d";
    const bullets = sections(
      buildExecutiveReadoutLines(mk({ values, notes }))
    ).bullets;
    expect(bullets[0].startsWith("PM Compliance")).toBe(true);
    expect(bullets[1].startsWith("Budget Spend")).toBe(true);
  });

  it("E: AMD-EZ blank Notes/Situation still produces no invented cause", () => {
    const bullets = sections(buildExecutiveReadoutLines(input("AMD-EZ"))).bullets;
    expect(bullets).toEqual([]); // NO commentary without Notes/Situation
    expect(bullets.join(" ")).toBe("");
    expect(bullets.join(" ")).not.toMatch(/Validate|MTTR|non-critical|Prioritize/i);
  });

  it("F: CWC and TWCI source-bound examples remain correct", () => {
    const cwc = sections(buildExecutiveReadoutLines(input("CWC"))).bullets;
    expect(cwc[0]).toContain("Budget Spend");
    expect(cwc[0]).toContain("media replacement");
    const twci = sections(buildExecutiveReadoutLines(input("TWCI"))).bullets;
    expect(twci.length).toBeLessThanOrEqual(3);
    expect(twci.join(" ")).not.toMatch(/Validate|Prioritize|Strengthen|Monitor/);
  });
});

describe("commentary period/value context (follow-up after PR #424)", () => {
  function cwcStyle() {
    return {
      businessUnit: "CWC",
      monthLabel: "August 2026",
      reportingMonth: 8,
      notes:
        "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
      situation: null,
      values: {
        pmCompliance: 100,
        budgetSpend: 80.49,
        pmCmWorkOrderRatio: 99.7,
        pmCmCostRatio: 83.36,
        mttrDays: 2.27,
        facilityUptime: 99.89,
      },
      monthlyValues: {
        budgetSpend: 132.646086391792,
      },
    } as unknown as ExecutiveReadoutInput;
  }

  it("CWC: failing Budget Spend WITH Notes gets 'KPI - Aug: value - note' context", () => {
    const bullets = sections(buildExecutiveReadoutLines(cwcStyle())).bullets;
    expect(bullets[0]).toMatch(/^Budget Spend — Aug: 132\.65% — Exceed budget due to media replacement/);
    // Historical failing months are NOT listed.
    expect(bullets.join(" ")).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul/);
  });

  it("YTD-only failure with monthly not failing uses 'YTD: value' context", () => {
    const input = cwcStyle();
    (input.monthlyValues as Record<string, number | null>).budgetSpend = 100; // monthly OK
    const bullets = sections(buildExecutiveReadoutLines(input)).bullets;
    expect(bullets[0]).toMatch(/^Budget Spend — YTD: 80\.49% — Exceed budget/);
  });

  it("failing KPI WITHOUT Notes/Situation produces NO bullet", () => {
    const input = cwcStyle();
    input.notes = null;
    const bullets = sections(buildExecutiveReadoutLines(input)).bullets;
    expect(bullets).toEqual([]);
  });
});
