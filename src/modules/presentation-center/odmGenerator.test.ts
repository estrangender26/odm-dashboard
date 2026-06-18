import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPresentation } from "./pptxBuilder";
import {
  ALL_FACILITIES_LABEL,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  type OdmInspectionRecord,
  type OdmScorecardDataset,
} from "./odmScorecardData";
import {
  buildOdmKpiCards,
  buildOdmSlides,
  generateOperatorDrivenMaintenanceDeck,
  ODM_DECK_TITLE,
  ODM_NO_ACTIONS_FALLBACK,
  ODM_NO_FINDINGS_FALLBACK,
  OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL,
  summarizeOdmRecords,
} from "./odmGenerator";

type OdmSlide = ReturnType<typeof buildOdmSlides>[number];

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

function makeRecord(
  overrides: Partial<OdmInspectionRecord> = {}
): OdmInspectionRecord {
  return {
    id: 1,
    facilityId: "HTT STP",
    inspector: "Operator A",
    inspectionDate: "2026-06-04",
    assetTag: "P-100",
    assetName: "Influent Pump",
    equipmentType: "Pump",
    category: "Mechanical",
    task: "Inspect pump condition",
    status: "Pass",
    score: 95,
    findings: null,
    date: "2026-06-04",
    submittedAt: "2026-06-04T08:00:00Z",
    entryNotes: null,
    escalationTrigger: null,
    ...overrides,
  };
}

function makeDataset(
  records: OdmInspectionRecord[],
  overrides: Partial<OdmScorecardDataset> = {}
): OdmScorecardDataset {
  return {
    records,
    reportingYear: 2026,
    reportingMonth: 6,
    reportingMonthLabel: "June 2026",
    facility: ALL_FACILITIES_LABEL,
    template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
    ...overrides,
  };
}

function slideText(slide: OdmSlide) {
  return slide.elements
    .flatMap(element => {
      if (element.type === "text") return [element.text];
      if (element.type === "table") return element.rows.flat();
      if (element.type === "bars") return [element.title, ...element.labels];
      return [];
    })
    .join("\n");
}

function explicitFontSizes(slides: OdmSlide[]) {
  return slides.flatMap(slide =>
    slide.elements.flatMap(element => {
      if (element.type === "text" || element.type === "table") {
        return element.fontSize === undefined ? [] : [element.fontSize];
      }
      return [];
    })
  );
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function readZipEntries(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let eocdOffset = -1;
  const eocdSearchStart = Math.max(0, bytes.length - 66000);

  for (let offset = bytes.length - 22; offset >= eocdSearchStart; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = readUint16(bytes, eocdOffset + 10);
  let offset = readUint32(bytes, eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    const localFileNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const contentStart =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const contentEnd = contentStart + compressedSize;
    const compressed = bytes.slice(contentStart, contentEnd);
    const content =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;
    expect(content).not.toBeNull();
    entries.set(name, decoder.decode(content ?? new Uint8Array()));
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload:
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

describe("Operator-Driven Maintenance presentation generator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the seven-slide scorecard with required titles and footer", () => {
    const slides = buildOdmSlides(
      makeDataset([
        makeRecord(),
        makeRecord({
          id: 2,
          facilityId: "Aglipay STP",
          status: "Fail",
          score: 0,
          findings: "Critical bearing vibration recorded.",
          entryNotes: "Inspect bearing alignment during next shift.",
          assetTag: "P-200",
          date: "2026-06-12",
        }),
      ]),
      new Date("2026-06-18T00:00:00Z")
    );
    const deckText = slides.map(slideText).join("\n");

    expect(slides).toHaveLength(7);
    expect(deckText).toContain(ODM_DECK_TITLE);
    expect(deckText).toContain("Executive Summary");
    expect(deckText).toContain("ODM KPI Cards");
    expect(deckText).toContain("Facility Breakdown");
    expect(deckText).toContain("Findings and Risk Themes");
    expect(deckText).toContain("Adoption and Execution Trend");
    expect(deckText).toContain("Action Items and Follow-up");
    expect(deckText).toContain(
      `June 2026 | ${ALL_FACILITIES_LABEL} | ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`
    );
    expect(deckText).toContain(
      `Generated from ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`
    );
    expect(Math.min(...explicitFontSizes(slides))).toBeGreaterThanOrEqual(14);
  });

  it("computes KPIs from persisted records while preserving explicit zero values", () => {
    const records = [
      makeRecord({ status: "Pending", score: 0, assetTag: null, assetName: null }),
      makeRecord({
        id: 2,
        status: "Fail",
        score: null,
        findings: "Pump seal leak observed.",
        assetTag: "P-200",
      }),
    ];

    expect(summarizeOdmRecords(records)).toMatchObject({
      totalRecords: 2,
      completionRate: 50,
      equipmentHealthScore: 0,
      assetsCovered: 1,
      facilitiesCovered: 1,
      openFindings: 1,
    });
    expect(buildOdmKpiCards(records).map(card => [card.label, card.value])).toEqual([
      ["Inspection Records Generated", "2"],
      ["Inspection Completion Rate", "50.0%"],
      ["Equipment Health Score", "0.0"],
      ["Assets Covered", "1"],
      ["Facilities Covered", "1"],
      ["Open Findings", "1"],
    ]);
  });

  it("uses clean fallbacks when findings, action notes, or score values are missing", () => {
    const slides = buildOdmSlides(
      makeDataset([
        makeRecord({
          score: null,
          findings: null,
          entryNotes: null,
          assetTag: null,
          assetName: null,
        }),
      ])
    );
    const deckText = slides.map(slideText).join("\n");

    expect(deckText).toContain("No score values recorded");
    expect(deckText).toContain(ODM_NO_FINDINGS_FALLBACK);
    expect(deckText).toContain(ODM_NO_ACTIONS_FALLBACK);
    expect(deckText).not.toContain("vendor support");
    expect(deckText).not.toContain("fake");
  });

  it("writes a valid PPTX package with seven slide parts and ODM content", async () => {
    const blob = await createPresentation(
      buildOdmSlides(
        makeDataset([
          makeRecord({
            findings: "Critical pump vibration recorded.",
            entryNotes: "Follow up with plant operator.",
          }),
        ])
      )
    );
    const entries = await readZipEntries(blob);
    const slidePaths = Array.from(entries.keys()).filter(path =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
    );
    const slideXml = slidePaths.map(path => entries.get(path)).join("\n");

    expect(slidePaths).toHaveLength(7);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
    expect(slideXml).toContain(ODM_DECK_TITLE);
    expect(slideXml).toContain("Critical pump vibration recorded");
    expect(slideXml).toContain("Follow up with plant operator");
  });

  it("passes selected period and facility to the ODM records endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        records: [
          {
            facility_id: "HTT STP",
            date: "2026-06-05",
            status: "Pass",
            score: 0,
            findings: null,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("crypto", { randomUUID: () => "odm-deck-id" });

    const deck = await generateOperatorDrivenMaintenanceDeck({
      generatedBy: "Test User",
      reportingYear: 2026,
      reportingMonth: 6,
      facility: "HTT STP",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operator-driven-maintenance/inspections?reporting_year=2026&reporting_month=6&facility_id=HTT+STP",
      { headers: { Accept: "application/json" } }
    );
    expect(deck).toMatchObject({
      id: "odm-deck-id",
      generatorId: "operator-driven-maintenance",
      generatorName: "Operator Driven Maintenance Deck",
      reportingYear: 2026,
      reportingMonth: 6,
      facility: "HTT STP",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
      generatedBy: "Test User",
    });
  });
});
