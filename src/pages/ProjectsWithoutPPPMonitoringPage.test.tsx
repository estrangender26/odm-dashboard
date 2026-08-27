// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// PROJECTS WITHOUT PPP — MASTERDATA SUBMITTAL MONITORING PAGE
// 1. Dashboard renders the 50 pre-populated project rows (no creation needed).
// 2. Search/filters work.
// 3. A Not Submitted project exposes an Upload action.
// 4. Successful upload updates KPI counts and marks the project Submitted
//    (dashboard + detail queries invalidated — no browser refresh).
// 5. No manual submission-status control is rendered.
// ============================================================================

const mocks = vi.hoisted(() => {
  const baseProject = (id: number, trackingId: string, overrides: Record<string, unknown> = {}) => ({
    id,
    trackingId,
    psCode: `2024-0${id}`,
    codingMask: `A1-ES-20240${id}`,
    projectPhase: "Construction",
    latestMilestone: "Ongoing",
    pmHeadline: "North",
    projectName: `Project ${trackingId}`,
    workPackage: `WP ${id}`,
    contractPackage: `CP ${id}`,
    contractor: "CONTRACTOR A",
    majorProjectTag: "TAG A",
    constructionManager: "CM A",
    projectManager: "PM A",
    withLSPs: false,
    amdGridHead: "Head A",
    createdAt: null,
    updatedAt: null,
    status: "not_submitted" as MasterdataSubmissionStatus,
    fileCount: 0,
    latestSubmission: null as LatestSubmissionSummary | null,
    ...overrides,
  });

  const fifty: ProjectWithoutPPPRow[] = Array.from({ length: 50 }, (_, i) =>
    baseProject(i + 1, `RR18-TEST-${String(i + 1).padStart(3, "0")}`),
  );

  const dashboardPayload = {
    kpis: { totalProjects: 50, submitted: 0, notSubmitted: 50, submissionRate: 0, totalFiles: 0, submittedToday: 0, submittedThisWeek: 0 },
    items: fifty,
    filterOptions: {
      projectPhases: ["Construction"],
      majorProjectTags: ["TAG A"],
      contractors: ["CONTRACTOR A"],
      constructionManagers: ["CM A"],
      projectManagers: ["PM A"],
      amdGridHeads: ["Head A"],
      withLSPs: ["yes", "no"],
      submissionStatuses: ["submitted", "not_submitted"],
    },
  };

  return {
    dashboardPayload,
    dashboardInvalidate: vi.fn(),
    detailInvalidate: vi.fn(),
    uploadFileDirect: vi.fn(),
    shouldUseDirectStorage: vi.fn(),
    attachInputs: [] as Record<string, unknown>[],
    attachOnSuccess: null as null | ((data: unknown) => void),
  };
});

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    createElement("a", { href: to, ...props }, children),
}));

vi.mock("@/components/ProgramsEngineeringLogo", () => ({
  default: () => createElement("img", { src: "/logo.svg", alt: "ODM" }),
}));

vi.mock("@/components/AIAssistant", () => ({
  default: () => null,
}));

vi.mock("@/lib/direct-storage-upload", () => ({
  shouldUseDirectStorage: (...args: unknown[]) => mocks.shouldUseDirectStorage(...args),
  uploadFileDirect: (...args: unknown[]) => mocks.uploadFileDirect(...args),
  storageFileUrl: (_source: string, id: number, action: string) => `/api/storage/files/x/${id}/${action}`,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { name: "Test User" } }),
}));

vi.mock("@/providers/trpc", () => {
  return {
    trpc: {
      useUtils: () => ({
        projectsWithoutPPP: {
          dashboard: { invalidate: mocks.dashboardInvalidate },
          detail: { invalidate: mocks.detailInvalidate },
        },
      }),
      projectsWithoutPPP: {
        dashboard: {
          useQuery: () => ({ data: mocks.dashboardPayload, isLoading: false }),
        },
        detail: {
          useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
            options?.enabled
              ? {
                  data: {
                    project: mocks.dashboardPayload.items[0],
                    status: "not_submitted",
                    files: [],
                  },
                  isLoading: false,
                }
              : { data: undefined, isLoading: false },
        },
        attachMasterdataFile: {
          useMutation: (options?: { onSuccess?: (data: unknown) => void; onError?: (e: Error) => void }) => {
            mocks.attachOnSuccess = options?.onSuccess ?? null;
            return {
              mutate: (input: Record<string, unknown>) => {
                mocks.attachInputs.push(input);
                mocks.attachOnSuccess?.({ fileId: 999 });
              },
              onSuccess: options?.onSuccess,
              onError: options?.onError,
            };
          },
        },
      },
    },
  };
});

import type { LatestSubmissionSummary, MasterdataSubmissionStatus, ProjectWithoutPPPRow } from "@/modules/projects-without-ppp/types";
import ProjectsWithoutPPPMonitoringPage from "./ProjectsWithoutPPPMonitoringPage";

describe("ProjectsWithoutPPPMonitoringPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldUseDirectStorage.mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the 50 pre-populated project rows without any create-project control", async () => {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    expect(screen.getByText("Total Projects")).toBeInTheDocument();
    expect(screen.getAllByText("50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not Submitted").length).toBeGreaterThan(0);
    // All 50 tracking IDs are rendered.
    expect(screen.getByText("RR18-TEST-001")).toBeInTheDocument();
    expect(screen.getByText("RR18-TEST-050")).toBeInTheDocument();
    // No project creation/edit/delete controls.
    expect(screen.queryByText(/Create Project/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Edit Project/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Delete Project/i)).not.toBeInTheDocument();
  });

  it("search filters the table", async () => {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    const search = screen.getByPlaceholderText(/Tracking ID, PS Code/);
    await userEvent.type(search, "RR18-TEST-007");
    expect(screen.getByText("RR18-TEST-007")).toBeInTheDocument();
    expect(screen.queryByText("RR18-TEST-001")).not.toBeInTheDocument();
  });

  it("shows 50 rows before filtering and a filtered count", async () => {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    expect(screen.getByText(/Showing 50 of 50 projects/)).toBeInTheDocument();
    const search = screen.getByPlaceholderText(/Tracking ID, PS Code/);
    await userEvent.type(search, "RR18-TEST-001");
    expect(screen.getByText(/Showing 1 of 50 projects/)).toBeInTheDocument();
  });

  it("exposes an Upload action for a Not Submitted project and uploads masterdata, updating KPIs", async () => {
    const { container } = render(createElement(ProjectsWithoutPPPMonitoringPage));
    // Open the first project detail.
    const uploadButtons = container.querySelectorAll("button");
    const firstUpload = Array.from(uploadButtons).find((b) => b.textContent === "Upload");
    expect(firstUpload).toBeTruthy();
    await userEvent.click(firstUpload!);

    // Detail panel shows the upload area (heading + button).
    expect(screen.getAllByText(/Upload Masterdata/).length).toBeGreaterThan(0);

    // Simulate selecting an approved Excel file via the hidden input.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toContain(".xlsx");

    const file = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      "masterdata.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
    await userEvent.upload(input, file);
    await waitFor(() => {
      expect(mocks.attachInputs.length).toBe(1);
    });
    expect(mocks.attachInputs[0].fileName).toBe("masterdata.xlsx");
    expect(mocks.attachInputs[0].projectId).toBe(1);
    expect(mocks.dashboardInvalidate).toHaveBeenCalled();
    expect(mocks.detailInvalidate).toHaveBeenCalled();
  });

  it("after a successful upload the project derives as Submitted and the KPI Submitted count rises", async () => {
    // Simulate the post-upload state: 1 submitted project, 2% rate, 1 file.
    mocks.dashboardPayload = {
      ...mocks.dashboardPayload,
      kpis: { totalProjects: 50, submitted: 1, notSubmitted: 49, submissionRate: 2, totalFiles: 1, submittedToday: 1, submittedThisWeek: 1 },
      items: mocks.dashboardPayload.items.map((p, i) =>
        i === 0 ? { ...p, status: "submitted", fileCount: 1, latestSubmission: { id: 1, fileName: "masterdata.xlsx", fileSize: 4, submittedBy: "Test User", submittedAt: new Date() } } : p,
      ),
    };
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    // KPI Submitted = 1, Submission Rate = 2%.
    expect(screen.getByText("2%")).toBeInTheDocument();
    // The uploaded project now shows Submitted status in the table.
    expect(screen.getByText("masterdata.xlsx")).toBeInTheDocument();
  });

  it("does not render a manual submission-status control", async () => {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    expect(screen.queryByText(/Mark as Submitted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark as Not Submitted/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/submission status/i)).not.toBeInTheDocument();
  });
});
