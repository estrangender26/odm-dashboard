// @vitest-environment jsdom
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listData: null as any,
  detailData: null as any,
  familiesData: [] as any[],
  listInputs: [] as any[],
  uploadFileDirect: vi.fn(),
  useAuthResult: { user: null as any, isAuthenticated: false, logout: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.useAuthResult,
}));

vi.mock("@/components/ProgramsEngineeringLogo", () => ({
  default: () => createElement("img", { src: "/logo.svg", alt: "ODM" }),
}));

vi.mock("@/components/AIAssistant", () => ({
  default: () => null,
}));

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    createElement("a", { href: to, ...props }, children),
}));

vi.mock("@/lib/direct-storage-upload", () => ({
  storageFileUrl: (source: string, id: number, action: string) => `/mock/${source}/${id}/${action}`,
  uploadFileDirect: (...args: unknown[]) => mocks.uploadFileDirect(...args),
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ smp: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } }),
    smp: {
      list: {
        useQuery: vi.fn((input: any) => {
          mocks.listInputs.push(input);
          return { data: mocks.listData, isLoading: false };
        }),
      },
      get: { useQuery: vi.fn(() => ({ data: mocks.detailData })) },
      families: { useQuery: vi.fn(() => ({ data: mocks.familiesData })) },
      update: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      delete: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      create: {
        useMutation: vi.fn(() => ({
          mutateAsync: vi.fn(async () => ({ id: 10 })),
          isPending: false,
        })),
      },
    },
  },
}));

import SmpDashboard from "./SmpDashboard";

const EMPTY_FILTERS = {
  families: [],
  equipmentTypes: [],
  facilityTypes: [],
  criticalities: [],
  revisions: [],
  statuses: [],
};

function makeDoc(overrides: Record<string, unknown>) {
  return {
    id: 1,
    code: "MW-ENGG-SP-1.0",
    smpId: null,
    title: "Centrifugal Pump System",
    smpFamily: "Centrifugal Pump System",
    assetName: null,
    assetType: null,
    equipmentType: "end-suction pumps",
    facilityType: "Treatment",
    applicability: ["All", "Volute"],
    criticality: "A",
    documentOwner: "Engineering",
    preparedBy: null,
    reviewedBy: null,
    approvedBy: null,
    effectivityDate: "2026-03-16",
    revision: "Rev. 0",
    status: "Active",
    system: null,
    dateIssued: null,
    nextReview: null,
    responsibleParty: null,
    hasFile: true,
    fileName: "MW-ENGG-SP-1.0.pdf",
    fileType: "application/pdf",
    uploadedBy: "Test User",
    uploadedAt: "2026-03-16T00:00:00.000Z",
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    revisionCount: 1,
    hasCurrentRevision: true,
    ...overrides,
  };
}

function renderPage() {
  return render(createElement(SmpDashboard));
}

describe("SMP controlled-document dashboard", () => {
  beforeEach(() => {
    mocks.listInputs = [];
    mocks.useAuthResult = { user: null, isAuthenticated: false, logout: mocks.useAuthResult.logout };
    mocks.listData = { items: [], count: 0, total: 0, filters: EMPTY_FILTERS };
    mocks.detailData = null;
    mocks.familiesData = [];
    mocks.uploadFileDirect.mockReset();
    mocks.uploadFileDirect.mockResolvedValue({ success: true, fileId: 1, source: "smp_document_revisions" });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a proper empty state with no demo-data affordances", () => {
    renderPage();
    expect(screen.getByText("No SMP documents yet")).toBeInTheDocument();
    expect(screen.getByText(/Upload Approved SMP PDF/)).toBeInTheDocument();
    expect(screen.queryByText("Load Demo")).not.toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it("renders only persisted SMP records", () => {
    mocks.listData = {
      items: [
        makeDoc({}),
        makeDoc({ id: 2, code: "MW-ENGG-SP-2.0", title: "Blower System", smpFamily: "Blower System", equipmentType: "screw blowers", criticality: "B", hasCurrentRevision: false, revisionCount: 0, status: "Draft" }),
      ],
      count: 2,
      total: 2,
      filters: { ...EMPTY_FILTERS, families: ["Centrifugal Pump System", "Blower System"], criticalities: ["A", "B"] },
    };
    renderPage();
    expect(screen.getByText(/MW-ENGG-SP-1\.0/)).toBeInTheDocument();
    expect(screen.getAllByText("Centrifugal Pump System").length).toBeGreaterThan(0);
    expect(screen.getByText(/MW-ENGG-SP-2\.0/)).toBeInTheDocument();
    expect(screen.getAllByText("Blower System").length).toBeGreaterThan(0);
  });

  it("passes the search text to the server-side library query", () => {
    mocks.listData = { items: [makeDoc({})], count: 1, total: 1, filters: EMPTY_FILTERS };
    renderPage();
    const search = screen.getByPlaceholderText(/Search reference no\./i);
    fireEvent.change(search, { target: { value: "pump" } });
    const lastInput = mocks.listInputs[mocks.listInputs.length - 1];
    expect(lastInput).toMatchObject({ search: "pump" });
  });

  it("passes filter selections to the server-side library query", () => {
    mocks.listData = {
      items: [makeDoc({})],
      count: 1,
      total: 1,
      filters: { ...EMPTY_FILTERS, criticalities: ["A", "B", "C"] },
    };
    renderPage();
    const criticality = screen.getAllByRole("combobox")[3];
    fireEvent.change(criticality, { target: { value: "A" } });
    const lastInput = mocks.listInputs[mocks.listInputs.length - 1];
    expect(lastInput).toMatchObject({ criticality: "A" });
  });

  it("renders the controlled-document detail sections", () => {
    mocks.listData = { items: [makeDoc({})], count: 1, total: 1, filters: EMPTY_FILTERS };
    mocks.detailData = {
      document: makeDoc({}),
      revisions: [
        { id: 11, documentId: 1, revision: "Rev. 0", revisionNumber: 0, status: "current", effectivityDate: "2026-03-16", supersededByRevisionId: null, originalFileName: "MW-ENGG-SP-1.0.pdf", fileType: "application/pdf", fileSize: 1234, uploadedBy: "Test User", uploadedAt: "2026-03-16T00:00:00.000Z", createdAt: null, updatedAt: null, storageBucket: "smp-library", storagePath: "v1/document-1/x", hasFile: true },
      ],
      sections: [
        { id: 1, documentId: 1, sectionKey: "objective", title: "Objective", body: "Maintain pump availability.", position: 1 },
      ],
      tasks: [
        { id: 1, documentId: 1, revisionId: null, category: "operator_driven", responsibilityType: "Operator", maintenanceClass: null, taskText: "Check bearing temperature", frequency: "Daily", toolsMaterials: "Thermometer", safetyControls: "PPE", fieldCaptureData: { temperature: "°C" }, escalationTrigger: "Above 90°C", failureMode: null, displayOrder: 0, applicabilityTags: ["All", "Volute"] },
      ],
    };
    renderPage();
    fireEvent.click(screen.getAllByText(/MW-ENGG-SP-1\.0/)[0]);
    expect(screen.getByText("Document Control")).toBeInTheDocument();
    expect(screen.getByText("Applicability")).toBeInTheDocument();
    expect(screen.getByText("Controlled Document")).toBeInTheDocument();
    expect(screen.getByText("Procedure Data")).toBeInTheDocument();
    expect(screen.getByText("Revision History")).toBeInTheDocument();
    expect(screen.getAllByText("Check bearing temperature").length).toBeGreaterThan(0);
    expect(screen.getByText(/Applies to: All, Volute/)).toBeInTheDocument();
    expect(screen.getAllByText(/Above 90°C/).length).toBeGreaterThan(0);
  });

  it("shows a structured-task empty state when no procedure data exists", () => {
    mocks.listData = { items: [makeDoc({})], count: 1, total: 1, filters: EMPTY_FILTERS };
    mocks.detailData = {
      document: makeDoc({}),
      revisions: [],
      sections: [],
      tasks: [],
    };
    renderPage();
    fireEvent.click(screen.getAllByText(/MW-ENGG-SP-1\.0/)[0]);
    expect(screen.getByText(/No structured procedure data yet/i)).toBeInTheDocument();
  });

  it("requires metadata and a PDF before uploading a new document", () => {
    renderPage();
    fireEvent.click(screen.getAllByText(/Upload SMP PDF/)[0]);
    expect(screen.getByText("Upload SMP — New Controlled Document")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create & Upload SMP"));
    expect(screen.getByText(/Reference number and title are required/)).toBeInTheDocument();
  });

  it("gates destructive and editing controls behind authentication", () => {
    mocks.listData = { items: [makeDoc({})], count: 1, total: 1, filters: EMPTY_FILTERS };
    mocks.detailData = { document: makeDoc({}), revisions: [], sections: [], tasks: [] };
    renderPage();
    fireEvent.click(screen.getAllByText(/MW-ENGG-SP-1\.0/)[0]);
    expect(screen.queryByText("🗑️ Delete")).not.toBeInTheDocument();
    expect(screen.queryByText("✏️ Edit Metadata")).not.toBeInTheDocument();

    cleanup();
    mocks.useAuthResult = { user: { role: "admin", name: "Admin" }, isAuthenticated: true, logout: mocks.useAuthResult.logout };
    renderPage();
    fireEvent.click(screen.getAllByText(/MW-ENGG-SP-1\.0/)[0]);
    expect(screen.getByText("✏️ Edit Metadata")).toBeInTheDocument();
    expect(screen.getByText("📤 Upload New Revision")).toBeInTheDocument();
    expect(screen.getByText("🗑️ Delete")).toBeInTheDocument();
  });
});

describe("SMP dashboard source hygiene", () => {
  const source = readFileSync(resolve(process.cwd(), "src/pages/SmpDashboard.tsx"), "utf8");

  it("contains no demo-data affordances", () => {
    expect(source).not.toContain("Load Demo");
    expect(source).not.toContain("Demo data loaded");
    expect(source).not.toContain("SMP-EQP-001");
    expect(source).not.toContain("seedMut");
  });

  it("contains no hard-coded equipment/system/status filter lists", () => {
    expect(source).not.toContain("EQUIPMENT_TYPES");
    expect(source).not.toContain("const SYSTEMS");
    expect(source).not.toContain("Under Review");
  });
});
