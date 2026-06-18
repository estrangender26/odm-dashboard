import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMonthlyKpiNotesText,
  buildMonthlyKpiSlides,
  buildMonthlyKpiTableRows,
  generateMonthlyKpiDeck,
  MONTHLY_KPI_NOTES_FALLBACK,
} from "./generators";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  type KpiRecord,
  type MonthlyKpiScorecardDataset,
} from "./scorecardData";

type MonthlyKpiSlide = ReturnType<typeof buildMonthlyKpiSlides>[number];
type BarElement = Extract<
  MonthlyKpiSlide["elements"][number],
  { type: "bars" }
>;
type TextElement = Extract<
  MonthlyKpiSlide["elements"][number],
  { type: "text" }
>;

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

function makeRecord(overrides: Partial<KpiRecord> = {}): KpiRecord {
  return {
    businessUnit: "AMD-EZ",
    reportingMonth: 5,
    reportingYear: 2026,
    pmCompliance: 96,
    budgetSpend: 101,
    pmCmWorkOrderRatio: 88,
    pmCmCostRatio: 64,
    mttrDays: 3.2,
    facilityUptime: 99.98,
    notes: null,
    majorWins: [],
    majorRisks: [],
    actionItems: [],
    ...overrides,
  };
}

function makeDataset(records: KpiRecord[]): MonthlyKpiScorecardDataset {
  return {
    records,
    reportingYear: 2026,
    reportingMonth: 5,
    reportingMonthLabel: "May 2026",
    businessUnit: ALL_BUSINESS_UNITS_LABEL,
    template: EXECUTIVE_SCORECARD_TEMPLATE,
  };
}

function slideText(slide: MonthlyKpiSlide) {
  return slide.elements
    .flatMap(element => (element.type === "text" ? [element.text] : []))
    .join("\n");
}

function barElements(slide: MonthlyKpiSlide) {
  return slide.elements.filter(
    (element): element is BarElement => element.type === "bars"
  );
}

function textElement(
  slide: MonthlyKpiSlide,
  predicate: (text: string) => boolean
) {
  const element = slide.elements.find(
    (entry): entry is TextElement =>
      entry.type === "text" && predicate(entry.text)
  );
  if (!element) throw new Error("Expected text element was not found");
  return element;
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;
  onerror:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;

  readAsDataURL() {
    this.result =
      "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,dGVzdA==";
    this.onload?.call(
      this as unknown as FileReader,
      {} as ProgressEvent<FileReader>
    );
  }
}

describe("Monthly KPI presentation generator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("places database notes on the Issues and Action Items slide", () => {
    const slides = buildMonthlyKpiSlides(
      makeDataset([
        makeRecord({
          businessUnit: "AMD-EZ",
          notes: "Pump station breaker replacement completed.",
        }),
        makeRecord({ businessUnit: "Laguna Water", notes: null }),
      ]),
      new Date("2026-06-18T00:00:00Z")
    );

    expect(slides).toHaveLength(5);
    expect(slideText(slides[4])).toContain(
      "AMD-EZ\nPump station breaker replacement completed."
    );
    expect(slideText(slides[4])).not.toContain(MONTHLY_KPI_NOTES_FALLBACK);
  });

  it("keeps title slide text boxes from overlapping", () => {
    const [titleSlide] = buildMonthlyKpiSlides(makeDataset([makeRecord()]));
    const title = textElement(titleSlide, text =>
      text.startsWith("Monthly KPI Scorecard\n")
    );
    const scope = textElement(titleSlide, text =>
      text.startsWith("Reporting Period:")
    );
    const source = textElement(titleSlide, text =>
      text.startsWith("Generated directly")
    );
    const timestamp = titleSlide.elements.find(
      (element): element is TextElement =>
        element.type === "text" && element.align === "r"
    );

    if (!timestamp) throw new Error("Expected timestamp text element");
    expect(title.y + title.h).toBeLessThanOrEqual(scope.y);
    expect(scope.y + scope.h).toBeLessThanOrEqual(source.y);
    expect(source.y + source.h).toBeLessThanOrEqual(timestamp.y);
  });

  it("uses the defined fallback when notes are null or empty", () => {
    expect(
      buildMonthlyKpiNotesText([
        makeRecord({ businessUnit: "AMD-EZ", notes: null }),
        makeRecord({ businessUnit: "Laguna Water", notes: "" }),
      ])
    ).toBe(MONTHLY_KPI_NOTES_FALLBACK);
  });

  it("keeps explicit zero KPI values in table rows and chart values", () => {
    const zeroRecord = makeRecord({
      pmCompliance: 0,
      facilityUptime: 0,
      notes: "Zero values were explicitly entered.",
    });
    const rows = buildMonthlyKpiTableRows([zeroRecord]);
    const slides = buildMonthlyKpiSlides(makeDataset([zeroRecord]));
    const charts = barElements(slides[3]);

    expect(rows[1][1]).toBe("0.00%");
    expect(rows[1][6]).toBe("0.00%");
    expect(charts[0].values).toEqual([0]);
    expect(charts[1].values).toEqual([0]);
  });

  it("passes reporting period selections to the records endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        records: [
          {
            business_unit: "AMD-EZ",
            reporting_year: 2026,
            reporting_month: 5,
            pm_compliance: 0,
            budget_spend: 101,
            pm_cm_work_order_ratio: 88,
            pm_cm_cost_ratio: 64,
            mttr_days: 3.2,
            facility_uptime: 99.98,
            notes: "Database note carried into the generated deck.",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("crypto", { randomUUID: () => "deck-id" });

    const deck = await generateMonthlyKpiDeck({
      generatedBy: "Test User",
      reportingYear: 2026,
      reportingMonth: 5,
      businessUnit: ALL_BUSINESS_UNITS_LABEL,
      template: EXECUTIVE_SCORECARD_TEMPLATE,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/monthly-kpi/records?reporting_year=2026&reporting_month=5",
      { headers: { Accept: "application/json" } }
    );
    expect(deck).toMatchObject({
      reportingYear: 2026,
      reportingMonth: 5,
      businessUnit: ALL_BUSINESS_UNITS_LABEL,
      template: EXECUTIVE_SCORECARD_TEMPLATE,
      generatedBy: "Test User",
    });
  });

  it("prevents generation when the records endpoint returns no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ records: [] }))
    );
    vi.stubGlobal("FileReader", MockFileReader);

    await expect(
      generateMonthlyKpiDeck({
        generatedBy: "Test User",
        reportingYear: 2026,
        reportingMonth: 6,
        businessUnit: ALL_BUSINESS_UNITS_LABEL,
        template: EXECUTIVE_SCORECARD_TEMPLATE,
      })
    ).rejects.toThrow(
      "No database records exist for the selected Monthly KPI reporting period and business unit."
    );
  });
});
