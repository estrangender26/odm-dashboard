import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPresentation, UploadedPresentation } from "./types";
import {
  cleanupGeneratedPresentationsHistory,
  cleanupUploadedPresentationsHistory,
  clearGeneratedPresentationsHistory,
  deleteGeneratedPresentation,
  deleteUploadedPresentation,
  deduplicateGeneratedPresentations,
  deduplicateUploadedPresentations,
  getGeneratedPresentationDedupeKey,
  getUploadedPresentationDedupeKey,
  mergeGeneratedPresentation,
  renameUploadedPresentation,
  replaceUploadedPresentation,
  saveGeneratedPresentations,
  validateUploadedFileName,
} from "./storage";

function makeDeck(overrides: Partial<GeneratedPresentation> = {}): GeneratedPresentation {
  return {
    id: crypto.randomUUID(),
    name: "test-deck.pptx",
    type: "Test Deck",
    generatedDate: new Date().toISOString(),
    generatedBy: "Test User",
    size: 1234,
    dataUrl: "data:application/octet-stream;base64,AA==",
    ...overrides,
  };
}

function makeUploaded(
  overrides: Partial<UploadedPresentation> = {}
): UploadedPresentation {
  return {
    id: crypto.randomUUID(),
    name: "template.pptx",
    uploadDate: new Date().toISOString(),
    uploadedBy: "Test User",
    size: 1234,
    category: "Uploaded Deck",
    dataUrl: "data:application/octet-stream;base64,AA==",
    ...overrides,
  };
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

describe("generated presentation deduplication", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a stable key from generator, filename, scope, facility, and template", () => {
    const deck = makeDeck({
      generatorId: "operator-driven-maintenance",
      generatorName: "Operator Driven Maintenance Deck",
      filename: "operator-driven-maintenance.pptx",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      facility: "HTT STP",
      template: "Executive Summary",
    });

    expect(getGeneratedPresentationDedupeKey(deck)).toBe(
      "operator-driven-maintenance::Operator Driven Maintenance Deck::operator-driven-maintenance.pptx::2026-06-01|2026-06-30::HTT STP::Executive Summary"
    );
  });

  it("uses all-dates label for ODM decks without explicit date range", () => {
    const deck = makeDeck({
      generatorId: "operator-driven-maintenance",
      generatorName: "Operator Driven Maintenance Deck",
      filename: "operator-driven-maintenance.pptx",
      facility: "All Facilities",
      template: "Executive Summary",
    });

    expect(getGeneratedPresentationDedupeKey(deck)).toContain("::all-dates::");
  });

  it("uses reporting period for Monthly KPI decks", () => {
    const deck = makeDeck({
      generatorId: "monthly-kpi-scorecard",
      generatorName: "Monthly KPI Scorecard Deck",
      filename: "monthly-kpi-scorecard.pptx",
      reportingYear: 2026,
      reportingMonth: 6,
      businessUnit: "All Business Units",
      template: "Executive Scorecard",
    });

    expect(getGeneratedPresentationDedupeKey(deck)).toContain("::2026-06::");
  });

  it("keeps the newest item per logical deck key when deduplicating", () => {
    const older = makeDeck({
      id: "older",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-01T10:00:00Z",
      generatedDate: "2026-06-01T10:00:00Z",
      dataUrl: "data:older",
    });
    const newer = makeDeck({
      id: "newer",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-02T10:00:00Z",
      generatedDate: "2026-06-02T10:00:00Z",
      dataUrl: "data:newer",
    });

    const result = deduplicateGeneratedPresentations([older, newer]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("newer");
    expect(result[0].dataUrl).toBe("data:newer");
  });

  it("keeps separate rows for different date ranges", () => {
    const june = makeDeck({
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      generatedAt: "2026-06-01T10:00:00Z",
      generatedDate: "2026-06-01T10:00:00Z",
    });
    const july = makeDeck({
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      generatedAt: "2026-07-01T10:00:00Z",
      generatedDate: "2026-07-01T10:00:00Z",
    });

    const result = deduplicateGeneratedPresentations([june, july]);

    expect(result).toHaveLength(2);
  });

  it("keeps separate rows for different facilities", () => {
    const htt = makeDeck({
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      facility: "HTT STP",
      generatedAt: "2026-06-01T10:00:00Z",
      generatedDate: "2026-06-01T10:00:00Z",
    });
    const aglipay = makeDeck({
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      facility: "Aglipay STP",
      generatedAt: "2026-06-02T10:00:00Z",
      generatedDate: "2026-06-02T10:00:00Z",
    });

    const result = deduplicateGeneratedPresentations([htt, aglipay]);

    expect(result).toHaveLength(2);
  });

  it("sorts deduplicated history newest first", () => {
    const oldKpi = makeDeck({
      generatorId: "monthly-kpi-scorecard",
      filename: "kpi.pptx",
      reportingYear: 2026,
      reportingMonth: 5,
      generatedAt: "2026-05-15T10:00:00Z",
      generatedDate: "2026-05-15T10:00:00Z",
    });
    const newOdm = makeDeck({
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-15T10:00:00Z",
      generatedDate: "2026-06-15T10:00:00Z",
    });

    const result = deduplicateGeneratedPresentations([oldKpi, newOdm]);

    expect(result[0].generatorId).toBe("operator-driven-maintenance");
  });

  it("replaces an existing deck with the same key when merging", () => {
    const original = makeDeck({
      id: "original",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-01T10:00:00Z",
      generatedDate: "2026-06-01T10:00:00Z",
      dataUrl: "data:original",
    });
    const regenerated = makeDeck({
      id: "regenerated",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-02T10:00:00Z",
      generatedDate: "2026-06-02T10:00:00Z",
      dataUrl: "data:regenerated",
    });

    const result = mergeGeneratedPresentation([original], regenerated);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("regenerated");
    expect(result[0].dataUrl).toBe("data:regenerated");
  });

  it("deduplicates existing localStorage history on read", () => {
    const duplicates = [
      makeDeck({
        id: "first",
        generatorId: "operator-driven-maintenance",
        filename: "odm.pptx",
        generatedAt: "2026-06-01T10:00:00Z",
        generatedDate: "2026-06-01T10:00:00Z",
      }),
      makeDeck({
        id: "second",
        generatorId: "operator-driven-maintenance",
        filename: "odm.pptx",
        generatedAt: "2026-06-02T10:00:00Z",
        generatedDate: "2026-06-02T10:00:00Z",
      }),
    ];
    window.localStorage.setItem(
      "odm.presentationCenter.generatedDecks",
      JSON.stringify(duplicates)
    );

    const result = cleanupGeneratedPresentationsHistory();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("second");
  });

  it("does not allow duplicate rows when saving", () => {
    const first = makeDeck({
      id: "first",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-01T10:00:00Z",
      generatedDate: "2026-06-01T10:00:00Z",
    });
    const second = makeDeck({
      id: "second",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      generatedAt: "2026-06-02T10:00:00Z",
      generatedDate: "2026-06-02T10:00:00Z",
    });

    saveGeneratedPresentations([first, second]);

    const stored = JSON.parse(
      window.localStorage.getItem("odm.presentationCenter.generatedDecks") || "[]"
    );

    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("second");
  });
});


describe("uploaded file / deck library management", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a stable dedupe key from name and category", () => {
    const deck = makeUploaded({ name: "template.pptx", category: "Uploaded Deck" });
    expect(getUploadedPresentationDedupeKey(deck)).toBe("template.pptx::Uploaded Deck");
  });

  it("keeps the newest upload when deduplicating by name and category", () => {
    const older = makeUploaded({
      id: "older",
      uploadDate: "2026-06-01T10:00:00Z",
      size: 1000,
      dataUrl: "data:older",
    });
    const newer = makeUploaded({
      id: "newer",
      uploadDate: "2026-06-02T10:00:00Z",
      size: 2000,
      dataUrl: "data:newer",
    });

    const result = deduplicateUploadedPresentations([older, newer]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("newer");
    expect(result[0].dataUrl).toBe("data:newer");
  });

  it("keeps separate rows for files with different categories", () => {
    const a = makeUploaded({ category: "Uploaded Deck" });
    const b = makeUploaded({ category: "Monthly KPI Scorecard" });

    const result = deduplicateUploadedPresentations([a, b]);

    expect(result).toHaveLength(2);
  });

  it("deduplicates existing localStorage uploaded files on cleanup", () => {
    const duplicates = [
      makeUploaded({ id: "first", uploadDate: "2026-06-01T10:00:00Z" }),
      makeUploaded({ id: "second", uploadDate: "2026-06-02T10:00:00Z" }),
    ];
    window.localStorage.setItem(
      "odm.presentationCenter.uploadedDecks",
      JSON.stringify(duplicates)
    );

    const result = cleanupUploadedPresentationsHistory();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("second");
  });

  it("validates file names", () => {
    expect(validateUploadedFileName("").valid).toBe(false);
    expect(validateUploadedFileName("../file.pptx").valid).toBe(false);
    expect(validateUploadedFileName("file.pdf").valid).toBe(false);
    expect(validateUploadedFileName("file.pptx").valid).toBe(true);
    expect(validateUploadedFileName("  file.pptx  ").valid).toBe(true);
  });

  it("renames an uploaded file and preserves its dataUrl", () => {
    const deck = makeUploaded({ id: "deck-1", name: "old.pptx" });
    const result = renameUploadedPresentation([deck], "deck-1", "new.pptx");

    expect(result.error).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("new.pptx");
    expect(result.items[0].dataUrl).toBe(deck.dataUrl);
  });

  it("does not rename to an invalid file name", () => {
    const deck = makeUploaded({ id: "deck-1" });
    const result = renameUploadedPresentation([deck], "deck-1", "../bad.pptx");

    expect(result.error).toBeDefined();
    expect(result.items[0].name).toBe(deck.name);
  });

  it("replaces an uploaded file and updates size and upload date", async () => {
    vi.stubGlobal("FileReader", MockFileReader);
    const deck = makeUploaded({
      id: "deck-1",
      name: "original.pptx",
      uploadDate: "2026-01-01T00:00:00Z",
    });
    const file = new File(["new content"], "replacement.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    const result = await replaceUploadedPresentation([deck], "deck-1", file, true);

    expect(result.error).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("original.pptx");
    expect(result.items[0].size).toBe(file.size);
    expect(result.items[0].uploadDate).not.toBe(deck.uploadDate);
  });

  it("rejects replacement with non-pptx files", async () => {
    const deck = makeUploaded({ id: "deck-1" });
    const file = new File(["x"], "bad.pdf", { type: "application/pdf" });

    const result = await replaceUploadedPresentation([deck], "deck-1", file);

    expect(result.error).toContain(".pptx");
    expect(result.items).toHaveLength(1);
  });

  it("deletes only the selected uploaded file", () => {
    const a = makeUploaded({ id: "a" });
    const b = makeUploaded({ id: "b" });

    const result = deleteUploadedPresentation([a, b], "a");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("deletes only the selected generated presentation entry", () => {
    const a = makeDeck({ id: "a" });
    const b = makeDeck({ id: "b" });

    const result = deleteGeneratedPresentation([a, b], "a");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("clears generated history without touching uploaded files", () => {
    window.localStorage.setItem(
      "odm.presentationCenter.generatedDecks",
      JSON.stringify([makeDeck()])
    );
    window.localStorage.setItem(
      "odm.presentationCenter.uploadedDecks",
      JSON.stringify([makeUploaded()])
    );

    const result = clearGeneratedPresentationsHistory();

    expect(result).toHaveLength(0);
    expect(
      JSON.parse(
        window.localStorage.getItem("odm.presentationCenter.uploadedDecks") || "[]"
      )
    ).toHaveLength(1);
  });
});
