import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratedPresentation, UploadedPresentation } from "./types";
import {
  cleanupGeneratedPresentationsHistory,
  createUploadedPresentation,
  dataUrlBase64Payload,
  base64ToBytes,
  deleteGeneratedPresentation,
  deleteUploadedPresentation,
  getGeneratedPresentations,
  getGeneratedPresentationDedupeKey,
  getUploadedPresentations,
  mergeGeneratedPresentation,
  renameUploadedPresentation,
  replaceUploadedPresentation,
  saveGeneratedPresentations,
} from "./storage";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function makeGenerated(overrides: Partial<GeneratedPresentation> = {}): GeneratedPresentation {
  return {
    id: "1",
    name: "generated.pptx",
    type: "Test Deck",
    generatedDate: new Date().toISOString(),
    generatedBy: "Test User",
    size: 1234,
    dataUrl: "/api/presentation-files/1/download",
    generatorId: "monthly-kpi-scorecard",
    generatorName: "Monthly KPI Scorecard Deck",
    filename: "generated.pptx",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeUploaded(overrides: Partial<UploadedPresentation> = {}): UploadedPresentation {
  return {
    id: "1",
    name: "template.pptx",
    uploadDate: new Date().toISOString(),
    uploadedBy: "Test User",
    size: 1234,
    category: "Uploaded Deck",
    dataUrl: "/api/presentation-files/1/download",
    ...overrides,
  };
}

describe("presentation storage API-backed helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps presentation history local in explicit Monthly KPI UI acceptance mode", async () => {
    vi.stubEnv("VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUploadedPresentations()).resolves.toEqual([]);
    await expect(getGeneratedPresentations()).resolves.toEqual([]);
    await expect(saveGeneratedPresentations([makeGenerated()])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("computes a stable generated presentation dedupe key", () => {
    const deck = makeGenerated({
      generatorId: "operator-driven-maintenance",
      generatorName: "Operator Driven Maintenance Deck",
      filename: "odm.pptx",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      facility: "HTT STP",
      template: "Executive Summary",
    });

    expect(getGeneratedPresentationDedupeKey(deck)).toBe(
      "operator-driven-maintenance::Operator Driven Maintenance Deck::odm.pptx::2026-06-01|2026-06-30::HTT STP::Executive Summary"
    );
  });

  it("merges a regenerated deck by replacing the matching row", () => {
    const original = makeGenerated({
      id: "1",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      dataUrl: "/api/1",
      generatedAt: "2026-06-01T10:00:00Z",
    });
    const regenerated = makeGenerated({
      id: "2",
      generatorId: "operator-driven-maintenance",
      filename: "odm.pptx",
      dataUrl: "/api/2",
      generatedAt: "2026-06-02T10:00:00Z",
    });

    const result = mergeGeneratedPresentation([original], regenerated);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
    expect(result[0].dataUrl).toBe("/api/2");
  });

  it("loads uploaded files from the backend API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          {
            id: 1,
            fileName: "report.pptx",
            displayName: "report.pptx",
            fileType: PPTX_MIME,
            mimeType: PPTX_MIME,
            fileSizeBytes: 1234,
            sha256Hash: "abc",
            fileCategory: "uploaded_deck",
            uploadedBy: "Test User",
            createdAt: "2026-06-01T10:00:00Z",
            updatedAt: "2026-06-01T10:00:00Z",
          },
        ],
      })
    ));

    const result = await getUploadedPresentations();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "1",
      name: "report.pptx",
      uploadedBy: "Test User",
      size: 1234,
      category: "Uploaded Deck",
      dataUrl: "/api/presentation-files/1/download",
    });
  });

  it("creates an uploaded presentation by posting to the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 5,
          fileName: "upload.pptx",
          displayName: "upload.pptx",
          fileType: PPTX_MIME,
          mimeType: PPTX_MIME,
          fileSizeBytes: 100,
          sha256Hash: "def",
          fileCategory: "uploaded_deck",
          uploadedBy: "ODM User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-01T10:00:00Z",
        },
      })
    ));

    const file = new File(["pptx"], "upload.pptx", { type: PPTX_MIME });
    const result = await createUploadedPresentation(file, {
      category: "Uploaded Deck",
      uploadedBy: "ODM User",
    });

    expect(result.error).toBeUndefined();
    expect(result.deck).toMatchObject({
      id: "5",
      name: "upload.pptx",
      uploadedBy: "ODM User",
      size: 100,
      category: "Uploaded Deck",
    });
  });

  it("renames an uploaded file by calling the backend API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 1,
          fileName: "old.pptx",
          displayName: "renamed.pptx",
          fileType: PPTX_MIME,
          mimeType: PPTX_MIME,
          fileSizeBytes: 1234,
          sha256Hash: "abc",
          fileCategory: "uploaded_deck",
          uploadedBy: "Test User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-02T10:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await renameUploadedPresentation(
      [makeUploaded({ id: "1", name: "old.pptx" })],
      "1",
      "renamed.pptx"
    );

    expect(result.error).toBeUndefined();
    expect(result.items[0].name).toBe("renamed.pptx");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files/1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("rejects invalid rename values", async () => {
    const result = await renameUploadedPresentation(
      [makeUploaded({ id: "1" })],
      "1",
      "../bad.pptx"
    );

    expect(result.error).toBeDefined();
    expect(result.items[0].name).toBe("template.pptx");
  });

  it("replaces an uploaded file via the backend API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 1,
          fileName: "new.pptx",
          displayName: "new.pptx",
          fileType: PPTX_MIME,
          mimeType: PPTX_MIME,
          fileSizeBytes: 999,
          sha256Hash: "xyz",
          fileCategory: "uploaded_deck",
          uploadedBy: "Test User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-02T10:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["new"], "new.pptx", { type: PPTX_MIME });
    const result = await replaceUploadedPresentation(
      [makeUploaded({ id: "1", name: "old.pptx" })],
      "1",
      file,
      false
    );

    expect(result.error).toBeUndefined();
    expect(result.items[0].name).toBe("new.pptx");
    expect(result.items[0].size).toBe(999);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files/1/replace",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("deletes an uploaded file by calling the backend API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteUploadedPresentation(
      [makeUploaded({ id: "1" }), makeUploaded({ id: "2" })],
      "1"
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files/1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deletes a generated presentation by calling the backend API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteGeneratedPresentation(
      [makeGenerated({ id: "1" }), makeGenerated({ id: "2" })],
      "1"
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presentation-files/1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("loads generated presentations from the backend API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          {
            id: 10,
            fileName: "kpi.pptx",
            displayName: "kpi.pptx",
            fileType: PPTX_MIME,
            mimeType: PPTX_MIME,
            fileSizeBytes: 5678,
            sha256Hash: "qwe",
            fileCategory: "generated_deck",
            generatorId: "monthly-kpi-scorecard",
            generatorName: "Monthly KPI Scorecard Deck",
            template: "Executive Scorecard",
            scopeJson: JSON.stringify({ reportingYear: 2026, reportingMonth: 6 }),
            uploadedBy: "ODM User",
            createdAt: "2026-06-01T10:00:00Z",
            updatedAt: "2026-06-01T10:00:00Z",
          },
        ],
      })
    ));

    const result = await cleanupGeneratedPresentationsHistory();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "10",
      name: "kpi.pptx",
      type: "Monthly KPI Scorecard Deck",
      generatorId: "monthly-kpi-scorecard",
      reportingYear: 2026,
      reportingMonth: 6,
      template: "Executive Scorecard",
      dataUrl: "/api/presentation-files/10/download",
    });
  });

  it("persists generated presentations with the RAW base64 payload and a sha256 over the decoded bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 20,
          fileName: "odm.pptx",
          displayName: "odm.pptx",
          fileType: PPTX_MIME,
          mimeType: PPTX_MIME,
          fileSizeBytes: 4,
          sha256Hash: "nonemptyhash",
          fileCategory: "generated_deck",
          generatorId: "operator-driven-maintenance",
          generatorName: "Operator Driven Maintenance Deck",
          uploadedBy: "ODM User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-01T10:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const deck = makeGenerated({
      id: "local-1",
      dataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,dGVzdA==",
      size: 4,
    });

    await saveGeneratedPresentations([deck]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe("/api/presentation-files/generated");
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.file_name).toBe("generated.pptx");
    // Regression: the blob must be the raw base64 payload of the PPTX, never
    // the full "data:...;base64," URL text (storing the URL text made every
    // later download base64-decode garbage instead of the deck).
    expect(body.file_blob).toBe("dGVzdA==");
    expect(body.file_blob).not.toContain("data:");
    expect(body.file_size_bytes).toBe(4);
    // Hash must be sha256 over the DECODED bytes ("test"), not the URL text.
    expect(body.sha256_hash).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
  });

  it("NEVER re-posts API-backed decks whose dataUrl is a download URL (stale/URL-as-blob corruption guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file: {
          id: 20,
          fileName: "generated.pptx",
          displayName: "generated.pptx",
          fileType: PPTX_MIME,
          mimeType: PPTX_MIME,
          fileSizeBytes: 4,
          sha256Hash: "hash",
          fileCategory: "generated_deck",
          uploadedBy: "ODM User",
          createdAt: "2026-06-01T10:00:00Z",
          updatedAt: "2026-06-01T10:00:00Z",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const apiBacked = makeGenerated({
      id: "5",
      dataUrl: "/api/presentation-files/5/download",
      filename: "existing.pptx",
      generatorId: "monthly-kpi-executive-scorecard",
    });
    const fresh = makeGenerated({
      id: "local-2",
      dataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBBQACAAIAAAA",
      filename: "fresh.pptx",
      generatorId: "monthly-kpi-executive-scorecard",
    });

    await saveGeneratedPresentations([apiBacked, fresh]);

    // Only the genuinely new deck (real data: URL) is posted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.file_name).toBe("fresh.pptx");
    expect(body.file_blob).toBe("UEsDBBQACAAIAAAA");
  });

  it("extracts the raw base64 payload from data URLs and rejects non-data values", () => {
    expect(
      dataUrlBase64Payload(
        "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBBQACAAIAAAA"
      )
    ).toBe("UEsDBBQACAAIAAAA");
    expect(dataUrlBase64Payload("/api/presentation-files/5/download")).toBeNull();
    expect(dataUrlBase64Payload("https://example.com/file.pptx")).toBeNull();
    expect(dataUrlBase64Payload("data:text/plain,hello")).toBeNull();
  });

  it("base64ToBytes decodes payloads byte-for-byte", () => {
    const bytes = base64ToBytes("UEsDBBQACAAIAAAA");
    expect(Array.from(bytes)).toEqual([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00, 0x00]);
  });
});

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
