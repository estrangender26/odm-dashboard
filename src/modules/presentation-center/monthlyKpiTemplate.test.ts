import fs from "node:fs/promises";
import { XMLValidator } from "fast-xml-parser";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMonthlyKpiTemplateSlides } from "./generators";
import {
  createMonthlyKpiTemplatePresentation,
  loadMonthlyKpiTemplate,
  MONTHLY_KPI_TEMPLATE_URL,
} from "./monthlyKpiTemplate";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  MONTH_NAMES,
  type KpiRecord,
  type MonthlyKpiScorecardDataset,
} from "./scorecardData";

const templatePath = new URL(
  "../../../public/templates/monthly-kpi-scorecard-template.potx",
  import.meta.url
);

function record(overrides: Partial<KpiRecord> = {}): KpiRecord {
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
    notes: "Representative 2026 commentary.",
    majorWins: [],
    majorRisks: [],
    actionItems: [],
    ...overrides,
  };
}

function dataset(
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

async function templateBytes() {
  return fs.readFile(templatePath);
}

async function zipText(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`Expected ${path}`);
  return file.async("string");
}

async function outputZip(data: MonthlyKpiScorecardDataset) {
  const blob = await createMonthlyKpiTemplatePresentation(
    await templateBytes(),
    buildMonthlyKpiTemplateSlides(data)
  );
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe("Monthly KPI PowerPoint template", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the checked-in POTX asset from the public template URL", async () => {
    const bytes = await templateBytes();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadMonthlyKpiTemplate()).resolves.toBeInstanceOf(ArrayBuffer);
    expect(fetchMock).toHaveBeenCalledWith(MONTHLY_KPI_TEMPLATE_URL, {
      headers: {
        Accept:
          "application/vnd.openxmlformats-officedocument.presentationml.template",
      },
    });
  });

  it("preserves slide geometry, master, layout, theme, named shapes, and legend asset", async () => {
    const source = await JSZip.loadAsync(await templateBytes());
    const output = await outputZip(
      dataset([record({ businessUnit: "AMD-EZ" })], {
        businessUnit: "AMD-EZ",
      })
    );
    const sourcePresentation = await zipText(source, "ppt/presentation.xml");
    const outputPresentation = await zipText(output, "ppt/presentation.xml");
    const outputSlide = await zipText(output, "ppt/slides/slide1.xml");
    const outputRels = await zipText(
      output,
      "ppt/slides/_rels/slide1.xml.rels"
    );

    expect(outputPresentation.match(/<p:sldSz\b[^>]*\/>/)?.[0]).toBe(
      sourcePresentation.match(/<p:sldSz\b[^>]*\/>/)?.[0]
    );
    for (const part of [
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout12.xml",
      "ppt/theme/theme1.xml",
      "ppt/media/image1.png",
    ]) {
      const sourcePart = source.file(part);
      const outputPart = output.file(part);
      expect(sourcePart, `${part} source`).not.toBeNull();
      expect(outputPart, `${part} output`).not.toBeNull();
      expect(await outputPart!.async("uint8array"), part).toEqual(
        await sourcePart!.async("uint8array")
      );
    }
    expect(outputRels).toContain("../slideLayouts/slideLayout12.xml");
    expect(outputRels).toContain("../media/image1.png");
    expect(outputSlide).toContain('name="TextBox 4"');
    expect(outputSlide).toContain('name="Table 2"');
    expect(outputSlide).toContain('name="TextBox 6"');
  });

  it("populates the individual-BU YTD table, values, statuses, benchmarks, ratios, and commentary", async () => {
    const output = await outputZip(
      dataset([record()], {
        businessUnit: "AMD-EZ",
        ytdRecords: [
          record({ reportingMonth: 1, pmCompliance: 100 }),
          record({
            reportingMonth: 2,
            pmCompliance: null,
            pmCmCostRatio: null,
          }),
          record({ reportingMonth: 5 }),
        ],
      })
    );
    const slide = await zipText(output, "ppt/slides/slide1.xml");

    expect(slide).toContain("AMD-EZ KPI – May 2026");
    expect(slide).toContain(">PM</a:t>");
    expect(slide).toContain(">Compliance</a:t>");
    expect(slide).toContain("Budget");
    expect(slide).toContain("PM:CM Ratio");
    expect(slide).toContain("MTTR");
    expect(slide).toContain("Facility Uptime");
    expect(slide).toContain("100.00%");
    expect(slide).toContain("88.00% (7.3:1)");
    expect(slide).toContain("No Data");
    expect(slide).toContain("95%–105%");
    expect(slide).toContain("≥86% (6:1)");
    expect(slide).toContain("≥60% (1.5:1)");
    expect(slide).toContain("=100%");
    expect(slide).toContain("Representative 2026 commentary.");
    expect(slide).toContain('val="00B050"');
    expect(slide).toContain('val="E7EAED"');
  });

  it("uses and duplicates the portfolio source slide for all business units", async () => {
    const records = [
      record({ businessUnit: "AMD-EZ" }),
      record({ businessUnit: "Laguna Water", pmCmCostRatio: null }),
      record({ businessUnit: "Clark Water", budgetSpend: 120 }),
      record({ businessUnit: "Tagum Water", pmCompliance: 80 }),
      record({ businessUnit: "Estate Water", facilityUptime: 99 }),
      record({ businessUnit: "LARC", pmCmWorkOrderRatio: 90 }),
    ];
    const output = await outputZip(dataset(records));
    const presentation = await zipText(output, "ppt/presentation.xml");
    const slide1 = await zipText(output, "ppt/slides/slide1.xml");
    const slide2 = await zipText(output, "ppt/slides/slide2.xml");

    expect(presentation.match(/<p:sldId\b/g)).toHaveLength(2);
    expect(slide1).toContain('name="Table 0"');
    expect(slide2).toContain('name="Table 0"');
    expect(`${slide1}${slide2}`).toContain("Laguna Water");
    expect(`${slide1}${slide2}`).toContain("LARC");
    expect(`${slide1}${slide2}`).toContain("No Data");
    expect(`${slide1}${slide2}`).toContain("90.00% (9.0:1)");
  });

  it("keeps every long commentary segment on template-matched continuation slides", async () => {
    const longToken = "L".repeat(180);
    const output = await outputZip(
      dataset(
        [
          record({
            notes: `First paragraph with a deliberately long operational explanation that must remain readable.\n\nSecond paragraph ${longToken} and a final sentence.`,
            majorWins: [
              "A detailed win that must not be silently removed from the presentation.",
            ],
            majorRisks: [
              "A detailed risk that must not be silently removed from the presentation.",
            ],
            actionItems: [
              "First follow-up action that must remain visible.",
              "Second follow-up action that must remain visible.",
            ],
          }),
        ],
        { businessUnit: "AMD-EZ" }
      )
    );
    const presentation = await zipText(output, "ppt/presentation.xml");
    const slidePaths = Object.keys(output.files).filter(path =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
    );
    const slides = await Promise.all(
      slidePaths.map(path => zipText(output, path))
    );
    const combined = slides.join("");

    expect(presentation.match(/<p:sldId\b/g)?.length).toBeGreaterThan(1);
    expect(combined).toContain("AMD-EZ Notes – May 2026");
    expect(combined).toContain(
      "First follow-up action that must remain visible."
    );
    expect(combined).toContain(
      "Second follow-up action that must remain visible."
    );
    expect(combined.match(/L{64}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(combined).toContain("(continued)");
    for (const slide of slides) {
      expect(slide).toContain('name="Table 2"');
      expect(slide).toContain('name="TextBox 6"');
    }
  });

  it("labels multi-month continuations with the correct periods without duplicating month rows", async () => {
    const ytdRecords = Array.from({ length: 12 }, (_, index) =>
      record({
        reportingMonth: index + 1,
        notes: null,
      })
    );
    const output = await outputZip(
      dataset([ytdRecords[11]], {
        businessUnit: "AMD-EZ",
        reportingMonth: 12,
        reportingMonthLabel: "December 2026",
        ytdRecords,
      })
    );
    const slides = await Promise.all(
      [1, 2, 3].map(index => zipText(output, `ppt/slides/slide${index}.xml`))
    );
    const combined = slides.join("");

    expect(slides[0]).toContain("AMD-EZ KPI – Jan–May 2026 (1/3)");
    expect(slides[1]).toContain("AMD-EZ KPI – Jun–Oct 2026 (2/3)");
    expect(slides[2]).toContain("AMD-EZ KPI – Nov–Dec 2026 (3/3)");
    for (const month of MONTH_NAMES.map(name => name.slice(0, 3))) {
      expect(combined.match(new RegExp(`>${month}<`, "g"))).toHaveLength(1);
    }
  });

  it("preserves source ordering for non-canonical business units across continuation slides", async () => {
    const businessUnits = Array.from(
      { length: 12 },
      (_, index) => `Acceptance BU ${index + 1}`
    );
    const output = await outputZip(
      dataset(businessUnits.map(businessUnit => record({ businessUnit })))
    );
    const slides = await Promise.all(
      [1, 2, 3].map(index => zipText(output, `ppt/slides/slide${index}.xml`))
    );
    const combined = slides.join("");
    const positions = businessUnits.map(businessUnit =>
      combined.indexOf(businessUnit)
    );

    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("emits a PPTX package with no unused sample slides or template comments", async () => {
    const output = await outputZip(
      dataset([record({ businessUnit: "AMD-EZ" })], {
        businessUnit: "AMD-EZ",
      })
    );
    const contentTypes = await zipText(output, "[Content_Types].xml");
    const paths = Object.keys(output.files);

    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
    );
    expect(contentTypes).not.toContain("template.main+xml");
    expect(
      paths.filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    ).toHaveLength(1);
    expect(paths.some(path => path.startsWith("ppt/comments/"))).toBe(false);
    expect(paths).not.toContain("ppt/authors.xml");
    expect(await zipText(output, "ppt/slides/slide1.xml")).not.toContain(
      "commentRel"
    );
    for (const [path, file] of Object.entries(output.files)) {
      if (!path.endsWith(".xml") && !path.endsWith(".rels")) continue;
      expect(XMLValidator.validate(await file.async("string")), path).toBe(
        true
      );
    }
  });
});
