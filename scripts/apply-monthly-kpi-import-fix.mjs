import fs from "node:fs";
import path from "node:path";

const targetPath = path.resolve(process.cwd(), "public/scorecard-kpi.html");
const original = fs.readFileSync(targetPath, "utf8");
let source = original;
let replacementCount = 0;

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function replaceExact(label, before, after, expected = 1) {
  const actual = occurrences(source, before);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected} match(es), found ${actual}`);
  }
  source = source.split(before).join(after);
  replacementCount += actual;
  console.log(`[patch] ${label}: ${actual}`);
}

replaceExact(
  "map MTBF aggregate aliases",
  `function aggregateKeyForUiKey(key){
  if(key==='pmcmWORatio')return 'pmCmWorkOrderRatio';
  if(key==='pmcmCostRatio')return 'pmCmCostRatio';
  if(key==='mttr')return 'mttrDays';
  return key;
}`,
  `function aggregateKeyForUiKey(key){
  if(key==='pmcmWORatio')return 'pmCmWorkOrderRatio';
  if(key==='pmcmCostRatio')return 'pmCmCostRatio';
  if(key==='mtbf')return 'mtbfDays';
  if(key==='mttr')return 'mttrDays';
  return key;
}`,
);

replaceExact(
  "map schedule compliance and MTBF snake-case aliases",
  `function snakeAggregateKeyForUiKey(key){
  if(key==='pmCompliance')return 'pm_compliance';
  if(key==='budgetSpend')return 'budget_spend';
  if(key==='pmcmWORatio')return 'pm_cm_work_order_ratio';
  if(key==='pmcmCostRatio')return 'pm_cm_cost_ratio';
  if(key==='mttr')return 'mttr_days';
  if(key==='facilityUptime')return 'facility_uptime';
  return key;
}`,
  `function snakeAggregateKeyForUiKey(key){
  if(key==='pmCompliance')return 'pm_compliance';
  if(key==='scheduleCompliance')return 'schedule_compliance';
  if(key==='budgetSpend')return 'budget_spend';
  if(key==='pmcmWORatio')return 'pm_cm_work_order_ratio';
  if(key==='pmcmCostRatio')return 'pm_cm_cost_ratio';
  if(key==='mtbf')return 'mtbf_days';
  if(key==='mttr')return 'mttr_days';
  if(key==='facilityUptime')return 'facility_uptime';
  return key;
}`,
);

replaceExact(
  "parse Summary rows without mutating live dashboard state",
  `    var record = ensureMonthlyRecord(buId,monthInfo.year,monthInfo.month);`,
  `    var record = {reportingYear:monthInfo.year,reportingMonth:monthInfo.month};`,
);

replaceExact(
  "persist Schedule Compliance and MTBF from Summary",
  `      pm_compliance: record.pm_compliance,
      pm_planned: record.pm_planned,
      budget_spend: record.budget_spend,
      pm_cm_work_order_ratio: record.pm_cm_work_order_ratio,
      pm_cm_cost_ratio: record.pm_cm_cost_ratio,
      mttr_days: record.mttr_days,`,
  `      pm_compliance: record.pm_compliance,
      pm_planned: record.pm_planned,
      schedule_compliance: record.schedule_compliance,
      budget_spend: record.budget_spend,
      pm_cm_work_order_ratio: record.pm_cm_work_order_ratio,
      pm_cm_cost_ratio: record.pm_cm_cost_ratio,
      mtbf_days: record.mtbf_days,
      mttr_days: record.mttr_days,`,
);

replaceExact(
  "remove optimistic Summary state publication",
  `  var selectedMonthRecord = getMonthlyRecord(buId,getSelectedYear(),getSelectedMonth());
  if(selectedMonthRecord)ScoreData[buId] = selectedMonthRecord;
`,
  ``,
);

replaceExact(
  "rehydrate Schedule Compliance and MTBF after refresh",
  `    record.pmCompliance = row.pm_compliance;
    record.pm_compliance = row.pm_compliance;
    record.pmPlanned = row.pm_planned;
    record.pm_planned = row.pm_planned;
    record.budgetSpend = row.budget_spend;
    record.budget_spend = row.budget_spend;
    record.pmcmWORatio = row.pm_cm_work_order_ratio;
    record.pm_cm_work_order_ratio = row.pm_cm_work_order_ratio;
    record.pmcmCostRatio = row.pm_cm_cost_ratio;
    record.pm_cm_cost_ratio = row.pm_cm_cost_ratio;
    record.mttr = row.mttr_days;
    record.mttr_days = row.mttr_days;`,
  `    record.pmCompliance = row.pm_compliance;
    record.pm_compliance = row.pm_compliance;
    record.pmPlanned = row.pm_planned;
    record.pm_planned = row.pm_planned;
    record.scheduleCompliance = row.schedule_compliance;
    record.schedule_compliance = row.schedule_compliance;
    record.budgetSpend = row.budget_spend;
    record.budget_spend = row.budget_spend;
    record.pmcmWORatio = row.pm_cm_work_order_ratio;
    record.pm_cm_work_order_ratio = row.pm_cm_work_order_ratio;
    record.pmcmCostRatio = row.pm_cm_cost_ratio;
    record.pm_cm_cost_ratio = row.pm_cm_cost_ratio;
    record.mtbf = row.mtbf_days;
    record.mtbf_days = row.mtbf_days;
    record.mttr = row.mttr_days;
    record.mttr_days = row.mttr_days;`,
);

replaceExact(
  "align manual-entry field mapping",
  `  var columns = {
    pmCompliance:'pm_compliance',
    budgetSpend:'budget_spend',
    pmcmWORatio:'pm_cm_work_order_ratio',
    pmcmCostRatio:'pm_cm_cost_ratio',
    mttr:'mttr_days',
    facilityUptime:'facility_uptime'
  };`,
  `  var columns = {
    pmCompliance:'pm_compliance',
    scheduleCompliance:'schedule_compliance',
    budgetSpend:'budget_spend',
    pmcmWORatio:'pm_cm_work_order_ratio',
    pmcmCostRatio:'pm_cm_cost_ratio',
    mtbf:'mtbf_days',
    mttr:'mttr_days',
    facilityUptime:'facility_uptime'
  };`,
);

replaceExact(
  "recognize Schedule Compliance and MTBF in legacy workbooks",
  `          if(h.includes('pmcompliance'))headerMap.pmCompliance=i;
          if(h.includes('budget'))headerMap.budgetSpend=i;
          if(h.includes('pmcm')&&h.includes('wo'))headerMap.pmcmWORatio=i;
          if(h.includes('pmcm')&&h.includes('cost'))headerMap.pmcmCostRatio=i;
          if(h.includes('mttr'))headerMap.mttr=i;`,
  `          if(h.includes('pmcompliance'))headerMap.pmCompliance=i;
          if(h.includes('schedulecompliance'))headerMap.scheduleCompliance=i;
          if(h.includes('budget'))headerMap.budgetSpend=i;
          if(h.includes('pmcm')&&h.includes('wo'))headerMap.pmcmWORatio=i;
          if(h.includes('pmcm')&&h.includes('cost'))headerMap.pmcmCostRatio=i;
          if(h.includes('mtbf'))headerMap.mtbf=i;
          if(h.includes('mttr'))headerMap.mttr=i;`,
);

replaceExact(
  "parse legacy rows without mutating live dashboard state",
  `          var record = ensureMonthlyRecord(importBuId,year,month);`,
  `          var record = {reportingYear:year,reportingMonth:month,business_unit:getBUApiValue(importBuId)};`,
);

replaceExact(
  "remove optimistic legacy state publication",
  `          ScoreData[importBuId] = record;
`,
  ``,
);

replaceExact(
  "persist Schedule Compliance and MTBF from legacy workbooks",
  `            pm_compliance: record.pmCompliance ?? null,
            pm_planned: record.pmPlanned ?? null,
            budget_spend: record.budgetSpend ?? null,
            pm_cm_work_order_ratio: record.pmcmWORatio ?? null,
            pm_cm_cost_ratio: record.pmcmCostRatio ?? null,
            mttr_days: record.mttr ?? null,`,
  `            pm_compliance: record.pmCompliance ?? null,
            pm_planned: record.pmPlanned ?? null,
            schedule_compliance: record.scheduleCompliance ?? null,
            budget_spend: record.budgetSpend ?? null,
            pm_cm_work_order_ratio: record.pmcmWORatio ?? null,
            pm_cm_cost_ratio: record.pmcmCostRatio ?? null,
            mtbf_days: record.mtbf ?? null,
            mttr_days: record.mttr ?? null,`,
);

replaceExact(
  "close a cancelled conflict import without showing unsaved values",
  `            if(!confirmReplace){
              if(createdBusinessUnit)removeBusinessUnitById(createdBusinessUnit.bu.id);
              return;
            }`,
  `            if(!confirmReplace){
              if(createdBusinessUnit)removeBusinessUnitById(createdBusinessUnit.bu.id);
              closeImportModal(true);
              showToast('warning','Import cancelled. Existing saved KPI records were kept.');
              return;
            }`,
  2,
);

replaceExact(
  "close Summary import modal immediately after persistence succeeds",
  `          await saveImportedMonthlyKpiRecords(file.name,summaryImport.records,importBuId);
          await fetchSavedMonthlyKpiRecords(importBuId);
          await switchToImportedBusinessUnit(importBuId);
          closeImportModal(true);`,
  `          await saveImportedMonthlyKpiRecords(file.name,summaryImport.records,importBuId);
          closeImportModal(true);
          await fetchSavedMonthlyKpiRecords(importBuId);
          await switchToImportedBusinessUnit(importBuId);`,
);

replaceExact(
  "close legacy import modal immediately after persistence succeeds",
  `        await saveImportedMonthlyKpiRecords(file.name,legacyRecords,importBuId);
        await fetchSavedMonthlyKpiRecords(importBuId);
        await switchToImportedBusinessUnit(importBuId);
        closeImportModal(true);`,
  `        await saveImportedMonthlyKpiRecords(file.name,legacyRecords,importBuId);
        closeImportModal(true);
        await fetchSavedMonthlyKpiRecords(importBuId);
        await switchToImportedBusinessUnit(importBuId);`,
);

if (source === original) {
  throw new Error("Patch made no changes");
}

const mode = process.argv.includes("--write") ? "write" : "check";
console.log(`[patch] ${replacementCount} guarded replacement(s) validated in ${mode} mode`);
if (mode === "write") {
  fs.writeFileSync(targetPath, source);
  console.log(`[patch] wrote ${targetPath}`);
}
