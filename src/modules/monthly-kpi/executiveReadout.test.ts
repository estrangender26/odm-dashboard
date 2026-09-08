import { describe, expect, it } from "vitest";
import {
  buildExecutiveReadoutLines,
  classifyExecutiveKpi,
  formatExecutiveKpiValue,
} from "./executiveReadout";
import type { ReadoutLine } from "../executive-presentations/framework/readoutText";
import type { ExecutiveReadoutInput } from "./executiveReadout";

type LinesLike = ReadoutLine[];

function linesOf(input: ExecutiveReadoutInput): LinesLike {
  return buildExecutiveReadoutLines(input);
}

function sections(lines: LinesLike): {
  exec: string[];
  assess: string[];
} {
  const exec: string[] = [];
  const assess: string[] = [];
  let current: string[] = exec;
  for (const line of lines) {
    if (line.kind === "heading") {
      if (line.text === "EXECUTIVE COMMENTARY") current = exec;
      if (line.text === "MANAGEMENT ASSESSMENT") current = assess;
    } else {
      current.push(line.text);
    }
  }
  return { exec, assess };
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}


// Real August-2026 production values (read-only query + authoritative deck data).
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
  EWG: {
    pmCompliance: 83.33333333333333,
    budgetSpend: 85.19961259863214,
    pmCmWorkOrderRatio: 100,
    pmCmCostRatio: 100,
    mttrDays: 126,
    facilityUptime: 99.95139966185559,
  },
  LAWC: {
    pmCompliance: 100,
    budgetSpend: 86.6514616129535,
    pmCmWorkOrderRatio: 93.76693766937669,
    pmCmCostRatio: 77.2501613932294,
    mttrDays: 0.3764492753623189,
    facilityUptime: 99.91097965749393,
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
  EWG:
    "PM Compliance: Greenways DW Rehabilitaion; Budget Spend: Assuming pump and motor for  replacement ; based on the actual activity the pump was operational and motor subject for replacement; PM CM Cost: Greenways Deepwell Rehab",
  LAWC:
    "Budget Spend: The repair of the pump and motor under PACER was accrued this month due to the revised quotation. The scope also included the pump repair under JT Max, which was similarly accrued following the quotation revision.; MTTR: Downtime resulted from the dismantling of the leaking diesel tank and the replacement of the pump and motor.\nVFD malfunction of VFD at Mabuhay 141",
  TWCI:
    "PM Compliance: Other PMS activities such as Painting works, Service vehicle pms was deffered to September due to materials and request was still on going thru S4.; Budget Spend: Only low value procurement was disbursed for month of August, other preventive maintenance does not require expenses such as cleaning and facility upkeeping.; PM CM Work Orders: PM(Sedimentation Cleaning,Flucculation tank cleaning,AR Lagoon desilting,Chlorination system pms, 2 dmf tank cleaning and disinfection, 1 dredger pms, grasscutting. power line clearing, aircon preventive maintenance )\nCM(Additional long arm for AR Lagoon recovery, 41KVA Assessment and Repair)\nCM(Well 2 Transmission line pole repair); PM CM Cost: PM(Sedimentation Cleaning,Flucculation tank cleaning,AR Lagoon desilting,Chlorination system pms, 2 dmf tank cleaning and disinfection, 1 dredger pms, grasscutting )\nCM(Additional long arm for AR Lagoon recovery, 41KVA Assessment and Repair) no expenses on repairs\nCM(Well 2 Transmission line pole repair); MTTR: Well 2 was down for 2 days due to damage transmission line pole; Facility Uptime: No downtime but August 21-26 was low production.",
};

function augInput(bu: string): ExecutiveReadoutInput {
  return {
    businessUnit: bu,
    monthLabel: "August 2026",
    notes: NOTES[bu] ?? null,
    situation: null,
    values: AUG[bu] as Record<string, number | null>,
  };
}

describe("Executive Commentary / Management Assessment - structure and limits", () => {
  it("A: never exceeds 2 bullets per section across the real August BUs", () => {
    for (const bu of ["AMD-EZ", "CWC", "LARC", "EWG", "LAWC", "TWCI"]) {
      const { exec, assess } = sections(linesOf(augInput(bu)));
      expect(exec.length, `${bu} EC bullet count`).toBeLessThanOrEqual(2);
      expect(assess.length, `${bu} MA bullet count`).toBeLessThanOrEqual(2);
    }
  });

  it("B: word budget is respected and long source Notes are compressed, not echoed", () => {
    for (const bu of ["AMD-EZ", "CWC", "LARC", "EWG", "LAWC", "TWCI"]) {
      const { exec, assess } = sections(linesOf(augInput(bu)));
      const execWords = exec.reduce((a, b) => a + words(b), 0);
      const assessWords = assess.reduce((a, b) => a + words(b), 0);
      expect(execWords, `${bu} EC words`).toBeLessThanOrEqual(48);
      expect(assessWords, `${bu} MA words`).toBeLessThanOrEqual(48);
    }
    // TWCI (1147-char note) must stay short: EC+MA combined far below the note length.
    const twci = sections(linesOf(augInput("TWCI")));
    const combined = [...twci.exec, ...twci.assess].join(" ").length;
    expect(combined).toBeLessThan(600);
    expect(NOTES.TWCI.length).toBeGreaterThan(1100);
  });

  it("C: blank commentary never produces invented causes and still yields a useful KPI-derived assessment (AMD-EZ)", () => {
    const { exec, assess } = sections(linesOf(augInput("AMD-EZ")));
    const all = [...exec, ...assess].join(" ");
    // No unsupported causal claim: the criticality hypothesis is phrased as a
    // request to CONFIRM, never as a fact.
    expect(all).not.toMatch(/involved non-critical/i);
    expect(all).toMatch(/Confirm whether long-duration repairs involved equipment/i);
    expect(all).toMatch(/Validate the reported MTTR/i);
    expect(all).not.toMatch(/elevated MTTR/i);
    expect(all).not.toContain("No commentary submitted.");
    expect(all).not.toContain("No situation submitted.");
  });

  it("D: red exceptions are prioritized over amber, and irrelevant greens are omitted unless contextually needed", () => {
    const twci = sections(linesOf(augInput("TWCI")));
    // TWCI reds: PM Compliance (62.31%), Budget Spend (65.62%); amber cost ratio.
    expect(twci.exec[0]).toContain("PM Compliance (62.31%)");
    expect(twci.exec[0]).toContain("Budget Spend (65.62%)");
    // PM:CM work-order ratio is green (89.8%) and must not be narrated.
    expect(twci.exec[0]).not.toContain("PM:CM work orders");
  });

  it("E: TWCI (long real commentary) - concise summary, no clipping-prone raw dump", () => {
    const { exec, assess } = sections(linesOf(augInput("TWCI")));
    const all = [...exec, ...assess].join(" ");
    expect(exec[0]).toContain("PM Compliance (62.31%)");
    expect(assess.some((a) => a.includes("Well 2 outage"))).toBe(true);
    expect(all.length).toBeLessThan(700);
  });

  it("F: AMD-EZ blank notes case - useful KPI-derived assessment with no invented cause", () => {
    const { exec, assess } = sections(linesOf(augInput("AMD-EZ")));
    expect(exec[0]).toContain("PM:CM work orders (84.4%)");
    expect(exec[0]).toContain("MTTR (85.86 days)");
    expect(assess.length).toBeGreaterThanOrEqual(2);
  });

  it("G: CWC strong BU stays concise and focused on material exceptions only", () => {
    const { exec, assess } = sections(linesOf(augInput("CWC")));
    const all = [...exec, ...assess].join(" ");
    // CWC: Budget Spend is the red exception; PM Compliance (100%) and the
    // near-No-CM ratios should not be narrated as exceptions.
    expect(exec[0]).toContain("Budget Spend (80.49%)");
    expect(all).not.toContain("PM Compliance (100.00%) was below");
    expect(exec.length).toBeLessThanOrEqual(2);
  });

  it("I: determinism - identical inputs produce byte-identical outputs", () => {
    const a = sections(linesOf(augInput("TWCI")));
    const b = sections(linesOf(augInput("TWCI")));
    expect(a.exec).toEqual(b.exec);
    expect(a.assess).toEqual(b.assess);
  });

  it("headings are EXECUTIVE COMMENTARY and MANAGEMENT ASSESSMENT (never raw Notes/Situation headings)", () => {
    for (const bu of ["AMD-EZ", "CWC", "TWCI"]) {
      const lines = linesOf(augInput(bu));
      expect(lines.map((l) => l.text)).not.toContain("Notes / Commentary");
      expect(lines.map((l) => l.text)).not.toContain("Situation");
      expect(lines.some((l) => l.text === "EXECUTIVE COMMENTARY")).toBe(true);
      expect(lines.some((l) => l.text === "MANAGEMENT ASSESSMENT")).toBe(true);
    }
  });
});

describe("classifier and formatter sanity", () => {
  it("formats values deterministically", () => {
    expect(formatExecutiveKpiValue("pmCompliance", 62.30590974087538)).toBe("62.31%");
    expect(formatExecutiveKpiValue("budgetSpend", 65.61519197829718)).toBe("65.62%");
    expect(formatExecutiveKpiValue("pmCmCostRatio", 67.485)).toBe("67.5%");
    expect(formatExecutiveKpiValue("mttrDays", 85.8614)).toBe("85.86 days");
  });

  it("classifies red/amber/green/missing from the scorecard thresholds", () => {
    expect(classifyExecutiveKpi("pmCompliance", 62.3)).toBe("red");
    expect(classifyExecutiveKpi("pmCompliance", 95)).toBe("amber");
    expect(classifyExecutiveKpi("pmCompliance", 98.5)).toBe("green");
    expect(classifyExecutiveKpi("budgetSpend", 80)).toBe("red");
    expect(classifyExecutiveKpi("budgetSpend", 115)).toBe("red");
    expect(classifyExecutiveKpi("budgetSpend", 107)).toBe("amber");
    expect(classifyExecutiveKpi("facilityUptime", 99.95)).toBe("amber");
    expect(classifyExecutiveKpi("facilityUptime", 100)).toBe("green");
    // MTTR has NO authoritative threshold band: reported data is "green"
    // (dataExistsGreen) and missing/null is "missing" - never a custom band.
    expect(classifyExecutiveKpi("mttrDays", 42.25)).toBe("green");
    expect(classifyExecutiveKpi("mttrDays", 2.27)).toBe("green");
    expect(classifyExecutiveKpi("mttrDays", 0)).toBe("missing");
    expect(classifyExecutiveKpi("mttrDays", null)).toBe("missing");
  });
});
