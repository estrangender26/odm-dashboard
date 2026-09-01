// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractSmpPdf: vi.fn(),
  uploadFileDirect: vi.fn(),
}));

vi.mock("./smpFormat", () => ({
  formatFileSize: (bytes: number) => `${bytes} B`,
  formatSmpDate: () => "—",
  toDateInputValue: () => "",
  extractSmpPdf: (...args: any[]) => mocks.extractSmpPdf(...args),
}));

vi.mock("@/lib/direct-storage-upload", () => ({
  uploadFileDirect: (...args: any[]) => mocks.uploadFileDirect(...args),
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ smp: { list: { invalidate: vi.fn() } } }),
  },
}));

import { SmpUploadModal } from "./SmpUploadModal";

function makePdfFile(name = "MW-ENGG-SP-1.0.pdf"): File {
  return new File(["pdf-bytes"], name, { type: "application/pdf" });
}

function makeTxtFile(): File {
  return new File(["text"], "notes.txt", { type: "text/plain" });
}

function uploadFileToHiddenInput(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const fileList = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
  } as unknown as FileList;
  Object.defineProperty(input, "files", { value: fileList, writable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function selectPdf(file: File) {
  const selectButton = screen.getByRole("button", { name: /Click to select the approved PDF/i });
  await userEvent.click(selectButton);
  await uploadFileToHiddenInput(file);
}

const fullExtraction = {
  code: "MW-ENGG-SP-1.0",
  title: "Centrifugal Pump",
  smpId: "SMP-2024-001",
  revision: "Rev. 0",
  effectivityDate: "2024-03-15",
  smpFamily: "Centrifugal Pump System",
  assetName: "Main pump A",
  assetType: "Rotating",
  equipmentType: "Centrifugal Pump",
  facilityType: "STP",
  criticality: "A",
  documentOwner: "Owner",
  preparedBy: "Preparer",
  reviewedBy: "Reviewer",
  approvedBy: "Approver",
  applicability: ["All"],
  sections: [],
  tasks: [],
  warnings: [],
  isEmpty: false,
};

const partialExtraction = {
  code: "MW-ENGG-SP-2.0",
  title: "Partial Document",
  revision: "Rev. 1",
  effectivityDate: null,
  smpId: null,
  smpFamily: null,
  assetName: null,
  assetType: null,
  equipmentType: null,
  facilityType: null,
  criticality: null,
  documentOwner: null,
  preparedBy: null,
  reviewedBy: null,
  approvedBy: null,
  applicability: [],
  sections: [],
  tasks: [],
  warnings: [],
  isEmpty: false,
};

const families = [
  { id: 1, name: "Centrifugal Pump System", code: "centrifugal-pump-system", typicalEquipment: ["end-suction pumps"], suggestedTags: ["All"], sortOrder: 1 },
  { id: 2, name: "Blower System", code: "blower-system", typicalEquipment: [], suggestedTags: ["All"], sortOrder: 2 },
];

describe("SmpUploadModal staged UX", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mocks.uploadFileDirect.mockResolvedValue({ success: true, documentId: 1, source: "smp_document_revisions" });
  });

  it("initially shows ONLY the PDF-selection UI and hides metadata fields", () => {
    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    expect(screen.getByText(/Select an approved SMP PDF/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Click to select the approved PDF/i })).toBeInTheDocument();

    expect(screen.queryByPlaceholderText("e.g. MW-ENGG-SP-1.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/Reference Number/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SMP Title/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Effectivity Date/i)).not.toBeInTheDocument();
  });

  it("rejects non-PDF files and clears the selection", async () => {
    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );
    await selectPdf(makeTxtFile());
    await waitFor(() => {
      expect(screen.getByText(/Only PDF files are accepted for SMP documents/i)).toBeInTheDocument();
    });
    expect(mocks.extractSmpPdf).not.toHaveBeenCalled();
  });

  it("shows extracting/loading state while reading the PDF", async () => {
    mocks.extractSmpPdf.mockImplementation(() => new Promise(() => {})); // never resolves

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());
    await waitFor(() => {
      expect(screen.getByText(/Reading SMP document…/i)).toBeInTheDocument();
    });
    expect(mocks.extractSmpPdf).toHaveBeenCalledTimes(1);
  });

  it("transitions to populated review state after successful extraction", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: fullExtraction });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Review SMP/i)).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("MW-ENGG-SP-1.0")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("Centrifugal Pump").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue("SMP-2024-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rev. 0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2024-03-15")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Main pump A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });

  it("auto-maps canonical family when extraction clearly matches a catalog family", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: fullExtraction });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Review SMP/i)).toBeInTheDocument();
    });

    const canonicalSelect = screen.getByTestId("canonical-family-select") as HTMLSelectElement;
    expect(canonicalSelect.value).toBe("1");
  });

  it("allows the user to edit/correct extracted values on review", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: fullExtraction });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Review SMP/i)).toBeInTheDocument();
    });

    const codeInput = screen.getByDisplayValue("MW-ENGG-SP-1.0");
    await userEvent.clear(codeInput);
    await userEvent.type(codeInput, "MW-ENGG-SP-1.1");

    expect(screen.getByDisplayValue("MW-ENGG-SP-1.1")).toBeInTheDocument();
  });

  it("clearly indicates missing fields on review", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: partialExtraction });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Review SMP/i)).toBeInTheDocument();
    });

    const missingBadges = screen.getAllByText(/Not found in PDF/i);
    expect(missingBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue("Partial Document")).toBeInTheDocument();
  });

  it("shows extraction error with retry and choose-another-pdf options", async () => {
    mocks.extractSmpPdf.mockRejectedValue(new Error("Server extraction error."));

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Server extraction error/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose another PDF/i })).toBeInTheDocument();
  });

  it("blocks a wrong-series PDF when uploading a new revision", async () => {
    mocks.extractSmpPdf.mockResolvedValue({
      extraction: {
        code: "MW-ENGG-SP-WRONG",
        title: "Wrong series",
        revision: "Rev. 1",
        applicability: [],
        sections: [],
        tasks: [],
        warnings: [],
        isEmpty: false,
      },
    });

    render(
      createElement(SmpUploadModal, {
        mode: "revision",
        document: {
          id: 3,
          code: "MW-ENGG-SP-1.0",
          title: "Pump",
          revision: "Rev. 0",
          status: "Active",
          hasCurrentRevision: true,
          revisionCount: 1,
        } as any,
        families,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile("MW-ENGG-SP-WRONG.pdf"));

    await waitFor(() => {
      expect(screen.getByText(/does not match this document series/)).toBeInTheDocument();
    });

    const uploadButton = screen.getByRole("button", { name: /Upload Revision/i });
    expect(uploadButton).toBeDisabled();
  });

  it("does not call uploadFileDirect when Cancel is clicked", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: fullExtraction });
    const onClose = vi.fn();

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose,
        onComplete: vi.fn(),
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByText(/Review SMP/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(mocks.uploadFileDirect).not.toHaveBeenCalled();
  });

  it("uses the existing governed finalize workflow on final confirmation", async () => {
    mocks.extractSmpPdf.mockResolvedValue({ extraction: fullExtraction });
    const onComplete = vi.fn();

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families,
        onClose: vi.fn(),
        onComplete,
      }),
    );

    await selectPdf(makePdfFile());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Upload Controlled Document/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Upload Controlled Document/i }));

    await waitFor(() => {
      expect(mocks.uploadFileDirect).toHaveBeenCalledTimes(1);
    });

    const call = mocks.uploadFileDirect.mock.calls[0][0];
    expect(call.module).toBe("smp");
    expect(call.target.code).toBe("MW-ENGG-SP-1.0");
    expect(call.target.title).toBe("Centrifugal Pump");
    expect(call.target.revision).toBe("Rev. 0");
    expect(onComplete).toHaveBeenCalledWith(1);
  });
});
