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

async function uploadFileToHiddenInput(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const fileList = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
  } as unknown as FileList;
  Object.defineProperty(input, "files", { value: fileList, writable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function uploadFile(file: File) {
  const dropButton = screen.getByRole("button", { name: /Click to select the approved PDF/i });
  await userEvent.click(dropButton);
  await uploadFileToHiddenInput(file);
}

describe("SmpUploadModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mocks.uploadFileDirect.mockResolvedValue({ success: true, documentId: 1, source: "smp_document_revisions" });
  });

  it("rejects non-PDF files and clears the selection", async () => {
    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families: [],
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );
    await uploadFile(makeTxtFile());
    await waitFor(() => {
      expect(screen.getByText(/Only PDF files are accepted for SMP documents/i)).toBeInTheDocument();
    });
    expect(mocks.extractSmpPdf).not.toHaveBeenCalled();
  });

  it("extracts and pre-fills empty controlled-document fields from a PDF", async () => {
    mocks.extractSmpPdf.mockResolvedValue({
      extraction: {
        code: "MW-ENGG-SP-1.0",
        title: "Centrifugal Pump",
        smpId: "SMP-2024-001",
        revision: "Rev. 0",
        effectivityDate: "2024-03-15",
        smpFamily: "Pump",
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
      },
    });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families: [],
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await uploadFile(makePdfFile());

    await waitFor(() => {
      expect(screen.getByDisplayValue("MW-ENGG-SP-1.0")).toBeInTheDocument();
    });

    expect(screen.getAllByDisplayValue("Centrifugal Pump").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue("SMP-2024-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rev. 0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2024-03-15")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pump")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Main pump A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });

  it("does not overwrite user-edited fields with extraction results", async () => {
    mocks.extractSmpPdf.mockResolvedValue({
      extraction: {
        code: "MW-ENGG-SP-99.0",
        title: "Extracted title",
        revision: "Rev. 1",
        effectivityDate: "2025-01-01",
        applicability: [],
        sections: [],
        tasks: [],
        warnings: [],
        isEmpty: false,
      },
    });

    render(
      createElement(SmpUploadModal, {
        mode: "new",
        document: null,
        families: [],
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    const codeInput = screen.getByPlaceholderText("e.g. MW-ENGG-SP-1.0");
    await userEvent.type(codeInput, "MW-ENGG-SP-USER");

    await uploadFile(makePdfFile());

    await waitFor(() => {
      expect(screen.getByDisplayValue("Extracted title")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("MW-ENGG-SP-USER")).toBeInTheDocument();
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
        families: [],
        onClose: vi.fn(),
        onComplete: vi.fn(),
      }),
    );

    await uploadFile(makePdfFile("MW-ENGG-SP-WRONG.pdf"));

    await waitFor(() => {
      expect(screen.getByText(/does not match this document series/)).toBeInTheDocument();
    });
  });
});
