import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCurrentMonthMatrixRows,
  buildMonthlyKpiNotesText,
  buildMonthlyKpiSlides,
  buildMonthlyKpiTableRows,
  buildPortfolioKpiCards,
  buildYtdScorecardRows,
  generateMonthlyKpiDeck,
  MONTHLY_KPI_DECK_DESIGN,
  MONTHLY_KPI_DECK_SOURCE_LABEL,
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
type TableElement = Extract<
  MonthlyKpiSlide["elements"][number],
  { type: "table" }
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

function makeDataset(
  records: KpiRecord[],
  overrides: Partial<MonthlyKpiScorecardDataset> = {}
): MonthlyKpiScorecardDataset {
  return {
    records,
    ytdRecords: records,
    reportingYear: 2026,
    reportingMonth: 5,
    reportingMonthLabel: "May 2026",
    businessUnit: ALL_BUSINESS_UNITS_LABEL,
    template: EXECUTIVE_SCORECARD_TEMPLATE,
    ...overrides,
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

function tableElement(slide: MonthlyKpiSlide) {
  const element = slide.elements.find(
    (entry): entry is TableElement => entry.type === "table"
  );
  if (!element) throw new Error("Expected table element was not found");
  return element;
}

function explicitFontSizes(slides: MonthlyKpiSlide[]) {
  return slides.flatMap(slide =>
    slide.elements.flatMap(element => {
      if (element.type === "text" || element.type === "table") {
        return element.fontSize === undefined ? [] : [element.fontSize];
      }
      return [];
    })
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

    expect(slides).toHaveLength(7);
    expect(slideText(slides[6])).toContain(
      "AMD-EZ\nPump station breaker replacement completed."
    );
    expect(slideText(slides[6])).not.toContain(MONTHLY_KPI_NOTES_FALLBACK);
  });

  it("keeps title slide text boxes from overlapping", () => {
    const [titleSlide] = buildMonthlyKpiSlides(makeDataset([makeRecord()]));
    const title = textElement(
      titleSlide,
      text => text === MONTHLY_KPI_DECK_SOURCE_LABEL
    );
    const scorecardContext = textElement(
      titleSlide,
      text => text === "Monthly KPI Scorecard"
    );
    const scope = textElement(
      titleSlide,
      text => text === ALL_BUSINESS_UNITS_LABEL
    );
    const period = textElement(titleSlide, text => text === "May 2026");
    const source = textElement(titleSlide, text =>
      text.startsWith(`Generated from ${MONTHLY_KPI_DECK_SOURCE_LABEL}`)
    );
    const timestamp = titleSlide.elements.find(
      (element): element is TextElement =>
        element.type === "text" && element.align === "r"
    );

    if (!timestamp) throw new Error("Expected timestamp text element");
    expect(title.y + title.h).toBeLessThanOrEqual(scorecardContext.y);
    expect(scorecardContext.y + scorecardContext.h).toBeLessThanOrEqual(
      Math.min(scope.y, period.y)
    );
    expect(period.x + period.w).toBeLessThanOrEqual(scope.x);
    expect(period.y + period.h).toBeLessThanOrEqual(source.y);
    expect(scope.y + scope.h).toBeLessThanOrEqual(source.y);
    expect(source.x + source.w).toBeLessThanOrEqual(timestamp.x);
  });

  it("uses the Monthly Scorecard dashboard title as the visible deck source", () => {
    const slides = buildMonthlyKpiSlides(makeDataset([makeRecord()]));
    const expectedFooter = `May 2026 | ${ALL_BUSINESS_UNITS_LABEL} | ${MONTHLY_KPI_DECK_SOURCE_LABEL}`;
    const deckText = slides.map(slideText).join("\n");

    for (const slide of slides) {
      expect(slideText(slide)).toContain(expectedFooter);
    }

    expect(deckText).toContain(
      `Generated from ${MONTHLY_KPI_DECK_SOURCE_LABEL}`
    );
    expect(deckText).not.toContain(
      `May 2026 | ${ALL_BUSINESS_UNITS_LABEL} | ODM Dashboard`
    );
    expect(deckText).not.toContain("Generated from ODM Dashboard");
  });

  it("uses reusable Engineering roadmap design tokens", () => {
    const [coverSlide, summarySlide] = buildMonthlyKpiSlides(
      makeDataset([makeRecord()])
    );

    expect(MONTHLY_KPI_DECK_DESIGN.slide).toMatchObject({
      layout: "LAYOUT_WIDE",
      width: 13.333,
      height: 7.5,
    });
    expect(MONTHLY_KPI_DECK_DESIGN.fonts).toMatchObject({
      title: "Aptos Display",
      body: "Aptos",
    });
    expect(MONTHLY_KPI_DECK_DESIGN.colors).toMatchObject({
      navy: "002060",
      accentBlue: "0070C0",
      success: "00B050",
      warning: "FFC000",
      danger: "C00000",
    });
    expect(
      coverSlide.elements.some(
        element =>
          element.type === "shape" &&
          element.fill === MONTHLY_KPI_DECK_DESIGN.colors.navy
      )
    ).toBe(true);
    expect(
      summarySlide.elements.some(
        element =>
          element.type === "shape" &&
          element.fill === MONTHLY_KPI_DECK_DESIGN.footer.fill
      )
    ).toBe(true);
  });

  it("builds the expected polished slide titles with no font below 14pt", () => {
    const slides = buildMonthlyKpiSlides(makeDataset([makeRecord()]));
    const deckText = slides.map(slideText).join("\n");

    expect(slides).toHaveLength(7);
    expect(deckText).toContain("Monthly KPI Scorecard");
    expect(deckText).toContain("Executive Summary");
    expect(deckText).toContain("Year-to-Date Scorecard");
    expect(deckText).toContain("Current-Month KPI Matrix");
    expect(deckText).toContain("Portfolio Average KPI Cards");
    expect(deckText).toContain("Business Unit Breakdown");
    expect(deckText).toContain("Notes, Issues, and Follow-up Actions");
    expect(Math.min(...explicitFontSizes(slides))).toBeGreaterThanOrEqual(14);
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
    const charts = barElements(slides[5]);

    expect(rows[1][1]).toBe("0.00%");
    expect(rows[1][6]).toBe("0.00%");
    expect(charts[0].values).toEqual([0]);
    expect(charts[1].values).toEqual([0]);
  });

  it("builds the YTD scorecard from January through the selected month only", () => {
    const dataset = makeDataset([], {
      ytdRecords: [
        makeRecord({
          reportingMonth: 1,
          pmCompliance: 0,
          budgetSpend: 100,
          facilityUptime: 99.98,
        }),
        makeRecord({
          reportingMonth: 5,
          pmCompliance: 96,
          budgetSpend: null,
          pmCmWorkOrderRatio: null,
          facilityUptime: 98.5,
        }),
      ],
    });
    const { rows, records } = buildYtdScorecardRows(dataset);
    const slides = buildMonthlyKpiSlides(dataset);
    const ytdTable = tableElement(slides[2]);

    expect(rows.map(row => row[0])).toEqual([
      "Month",
      "January",
      "February",
      "March",
      "April",
      "May",
    ]);
    expect(rows.flat()).not.toContain("June");
    expect(rows[1][1]).toBe("0.00%");
    expect(rows[2][1]).toBe("No Data");
    expect(records[0].pmCompliance).toBe(0);
    expect(ytdTable.fontSize).toBeGreaterThanOrEqual(14);
    expect(Math.min(...(ytdTable.rowHeights || []))).toBeGreaterThanOrEqual(
      0.44
    );
    expect(ytdTable.cellFills?.[0][0]).toBe(
      MONTHLY_KPI_DECK_DESIGN.table.headerFill
    );
    expect(ytdTable.cellFills?.[1][1]).toBe(
      MONTHLY_KPI_DECK_DESIGN.colors.danger
    );
    expect(ytdTable.cellFills?.[2][1]).toBe(
      MONTHLY_KPI_DECK_DESIGN.colors.noData
    );
    expect(ytdTable.cellFills?.[5][1]).toBe(
      MONTHLY_KPI_DECK_DESIGN.colors.success
    );
  });

  it("builds the current-month matrix in dashboard business-unit order", () => {
    const laguna = makeRecord({
      businessUnit: "Laguna Water",
      pmCompliance: null,
      facilityUptime: 99.97,
    });
    const amd = makeRecord({
      businessUnit: "AMD-EZ",
      pmCompliance: 0,
      facilityUptime: 99.5,
    });
    const larc = makeRecord({
      businessUnit: "LARC",
      pmCompliance: 97,
      facilityUptime: null,
    });
    const { rows } = buildCurrentMonthMatrixRows([laguna, amd, larc]);
    const slides = buildMonthlyKpiSlides(makeDataset([laguna, amd, larc]));
    const matrixTable = tableElement(slides[3]);

    expect(rows.map(row => row[0])).toEqual([
      "Business Unit",
      ALL_BUSINESS_UNITS_LABEL,
      "AMD-EZ",
      "Laguna Water",
      "LARC",
    ]);
    expect(rows[2][1]).toBe("0.00%");
    expect(rows[3][1]).toBe("No Data");
    expect(matrixTable.fontSize).toBeGreaterThanOrEqual(14);
    expect(Math.min(...(matrixTable.rowHeights || []))).toBeGreaterThanOrEqual(
      0.44
    );
    expect(matrixTable.cellFills?.[2][1]).toBe(
      MONTHLY_KPI_DECK_DESIGN.colors.danger
    );
    expect(matrixTable.cellFills?.[3][1]).toBe(
      MONTHLY_KPI_DECK_DESIGN.colors.noData
    );
  });

  it("renders the six portfolio KPI cards with exact benchmark labels", () => {
    const cards = buildPortfolioKpiCards([makeRecord()]);

    expect(cards.map(card => card.label)).toEqual([
      "PM Compliance",
      "Budget Spend",
      "PM:CM Ratio (WO)",
      "PM:CM Ratio (Cost)",
      "MTTR",
      "Facility Uptime",
    ]);
    expect(cards.map(card => card.benchmark)).toEqual([
      "95%",
      "95.00% – 105.00%",
      "≥86% (6:1)",
      "≥60% (1.5:1)",
      "Decreasing Trend",
      "99.97%",
    ]);
  });

  it("uses the notes fallback and caps visible note cards", () => {
    const fallbackSlides = buildMonthlyKpiSlides(
      makeDataset([makeRecord({ notes: null })])
    );
    expect(slideText(fallbackSlides[6])).toContain(MONTHLY_KPI_NOTES_FALLBACK);

    const slides = buildMonthlyKpiSlides(
      makeDataset([
        makeRecord({ businessUnit: "AMD-EZ", notes: "One" }),
        makeRecord({ businessUnit: "Laguna Water", notes: "Two" }),
        makeRecord({ businessUnit: "Clark Water", notes: "Three" }),
        makeRecord({ businessUnit: "Tagum Water", notes: "Four" }),
      ])
    );
    expect(slideText(slides[6])).toContain("+1 more notes not shown");
    expect(slideText(slides[6])).not.toContain("Four");
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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/monthly-kpi/records?reporting_year=2026&reporting_month=5",
      { headers: { Accept: "application/json" } }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/monthly-kpi/records?reporting_year=2026",
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
