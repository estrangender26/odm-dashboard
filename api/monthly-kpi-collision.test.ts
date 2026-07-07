import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const scorecardHtml = readFileSync("./public/scorecard-kpi.html", "utf-8");
const scorecardScript = scorecardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function createMockXLSX() {
  return {
    SSF: {
      parse_date_code(value: number) {
        const epoch = new Date(1899, 11, 30);
        const date = new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
        return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
      },
    },
    utils: {
      encode_cell({ r, c }: { r: number; c: number }) {
        return String.fromCharCode(65 + c) + (r + 1);
      },
      sheet_to_json(sheet: { _rows?: unknown[][] }, opts: any) {
        if (opts.header === 1 && Array.isArray(sheet._rows)) {
          const rangeMatch = opts.range?.match(/A1:([A-Z]+)(\d+)/);
          const maxRow = rangeMatch ? Number(rangeMatch[2]) : sheet._rows.length;
          return sheet._rows.slice(0, maxRow).map((row) =>
            Array.isArray(row) ? row.map((cell) => (cell && typeof cell === "object" && "v" in cell ? (cell as { v: unknown }).v : cell)) : []
          );
        }
        return [];
      },
    },
  };
}

describe("MTTR and Facility Uptime field collision regression", () => {
  it("does not leak MTTR downtime into Facility Uptime", () => {
    const element: any = {
      addEventListener() {}, appendChild() {}, remove() {},
      classList: { add() {}, remove() {}, toggle() {} }, style: {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      set innerHTML(_: string) {}, get innerHTML() { return ""; },
      value: "2026", focus() {},
    };
    const ctx: any = {
      console,
      setTimeout,
      XLSX: createMockXLSX(),
      window: {},
      document: {
        getElementById: () => element,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        body: element,
      },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      Chart: function() { return { destroy() {} }; },
      FileReader: class { onload: any; readAsArrayBuffer() { setTimeout(() => this.onload?.({ target: { result: new ArrayBuffer(0) } }), 0); } },
    };
    vm.createContext(ctx);
    vm.runInContext(scorecardScript, ctx);

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["MTTR", "Facility Uptime"],
      Sheets: {
        MTTR: makeSheet([
          ["Business Unit", "Month", "Total Downtime", "Number of Repairs", "Notes"],
          ["AMD-EZ", 46054, 48, 2, null], // Feb only MTTR data
        ]),
        "Facility Uptime": makeSheet([
          ["Business Unit", "Month", "Total Operating Time", "Total Downtime", "Notes"],
          ["AMD-EZ", 46023, 744, 0, null], // Jan uptime downtime 0
          ["AMD-EZ", 46054, 672, 0, null], // Feb uptime downtime 0
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "collision-test.xlsx");
    expect(result.imported).toBe(2);

    const jan = result.records.find((r: any) => r.reporting_month === 1);
    const feb = result.records.find((r: any) => r.reporting_month === 2);

    // Jan has only Facility Uptime data; MTTR should be null.
    expect(jan.mttr_days).toBeNull();
    expect(jan.facility_uptime).toBeCloseTo(100, 2);
    // Feb has both; MTTR should use MTTR downtime, Facility Uptime should use uptime downtime.
    expect(feb.mttr_days).toBeCloseTo(24, 2);
    expect(feb.facility_uptime).toBeCloseTo(100, 2);

    // Raw imported values must be KPI-specific and not leak across sheets.
    expect(feb.raw_imported_values.values.mttr_downtime).toBe(48);
    expect(feb.raw_imported_values.values.facility_downtime).toBe(0);
    expect(feb.mttr_downtime).toBe(48);
    expect(feb.facility_downtime).toBe(0);
    expect(feb.total_downtime).toBeNull(); // should not use shared generic field for these KPI-specific sheets
  });
});
