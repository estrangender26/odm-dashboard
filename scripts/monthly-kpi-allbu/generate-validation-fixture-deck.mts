#!/usr/bin/env node
/**
 * Generate the fixture-based All-Business-Units deck used for the Manila
 * Water master-clone visual validation (validation-artifacts/).
 *
 *   node scripts/monthly-kpi-allbu/generate-validation-fixture-deck.mts
 *
 * Uses the same fixture semantics as allBusinessUnitsDeck.test.ts: three BUs
 * with a common portfolio effective month of August 2026 (AMD-EZ and Clark
 * Water submit through August; Tagum Water lags at June). No database access.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllBusinessUnitsDeckData } from "../../src/modules/monthly-kpi/allBusinessUnitsData.ts";
import { generateAllBusinessUnitsMonthlyKpiDeck } from "../../src/modules/monthly-kpi/allBusinessUnitsDeck.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = path.join(repoRoot, "validation-artifacts", "monthly-kpi-mw-clone-validation");
const outPath = path.join(
  outDir,
  "Monthly KPI Scorecard - All Business Units - August 2026 (MW clone).pptx"
);

const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

function makeRecords(
  businessUnit: string,
  opts: { through?: number; notesBy?: Record<number, string>; situationBy?: Record<number, string> } = {}
) {
  const through = opts.through ?? 8;
  const notesBy = opts.notesBy ?? {};
  const situationBy = opts.situationBy ?? {};
  const out = [];
  for (let month = 1; month <= 12; month++) {
    if (month > through) {
      out.push({
        ...base,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        budget: 1000 * month,
        notes: null,
        situation: null,
      });
      continue;
    }
    const downtime = 60 * month + 5;
    const repairs = month + 2;
    out.push({
      ...base,
      business_unit: businessUnit,
      reporting_year: 2026,
      reporting_month: month,
      notes: notesBy[month] ?? null,
      situation: situationBy[month] ?? null,
      pm_orders_completed_on_time: 100 - month,
      total_pm_orders: 100,
      actual_spend: 100 * month + 10,
      budget: 200,
      budget_spend: ((100 * month + 10) / 200) * 100,
      pm_work_orders: 40 + month,
      cm_work_orders: 20 - (month % 3),
      pm_cm_work_order_ratio: ((40 + month) / (60 + month - (month % 3))) * 100,
      pm_cost: 1000 + 50 * month,
      cm_cost: 500 - 10 * month,
      pm_cm_cost_ratio: ((1000 + 50 * month) / (1500 + 40 * month)) * 100,
      mttr_downtime: downtime,
      repair_count: repairs,
      mttr_days: downtime / repairs,
      facility_operating_time: 1000,
      facility_downtime: month,
      facility_uptime: ((1000 - month) / 1000) * 100,
      raw_imported_values: { values: {} },
    });
  }
  return out;
}

// AMD-EZ mirrors the verified production state for August 2026: no stored
// Notes and no stored Situation -> its Slide 1 renders the neutral line only.
// CWC carries the REAL production August 2026 note (verified read-only against
// https://odm-dashboard.onrender.com) plus a clearly labeled demo Situation
// line, because production has no stored Situation anywhere yet (the field is
// introduced by this PR and remains NULL for existing records).
const records = [
  ...makeRecords("AMD-EZ", { through: 8 }),
  ...makeRecords("CWC", {
    through: 8,
    notesBy: {
      8: "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
    },
    situationBy: {
      8: "Media replacement for the PS1 9MLD WTP and 6MLD GAC DW44 was completed inside the August window. (fixture-only demo Situation - production has no stored Situation yet)",
    },
  }).map((r) => ({ ...r, pm_cost: null, cm_cost: null, pm_cm_cost_ratio: null })),
  ...makeRecords("Tagum Water", { through: 6 }),
];

const data = buildAllBusinessUnitsDeckData(records, 2026, 9);
const blob = await generateAllBusinessUnitsMonthlyKpiDeck(data);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
console.log(
  `Wrote ${outPath} — effective ${data.effectiveReportingMonthLabel}, ${data.sections.length} business unit(s): ${data.sections
    .map((s) => `${s.businessUnit}[${s.trends.length} months]`)
    .join(", ")}`
);
