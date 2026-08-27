// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    attachOnError: null as null | ((e: Error) => void),
    attachShouldFail: false,
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
            mocks.attachOnError = options?.onError ?? null;
            return {
              mutate: (input: Record<string, unknown>) => {
                mocks.attachInputs.push(input);
                if (mocks.attachShouldFail) {
                  mocks.attachOnError?.(new Error("simulated upload failure"));
                } else {
                  mocks.attachOnSuccess?.({ fileId: 999 });
                }
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
    mocks.attachShouldFail = false;
  });

  afterEach(() => {
    cleanup();
  });

  // Opens the first project's detail panel, then the Upload Masterdata modal.
  async function openUploadModal() {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    const buttons = Array.from(document.querySelectorAll("button"));
    const rowAction = buttons.find((b) => b.textContent === "Upload");
    expect(rowAction).toBeTruthy();
    await userEvent.click(rowAction!);
    const openButton = screen.getByRole("button", { name: /Upload Masterdata/ });
    await userEvent.click(openButton);
    return await screen.findByRole("dialog");
  }

  function masterdataFile() {
    return new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
      "masterdata.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
  }

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

  it("clicking Upload Masterdata opens a centered modal dialog in front of the dashboard", async () => {
    const dialog = await openUploadModal();
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    // Radix Dialog portals the content to document.body, in front of the page.
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument();
    // The dashboard remains rendered behind the overlay.
    expect(screen.getByText("Total Projects")).toBeInTheDocument();
    expect(within(dialog).getByText("Upload Masterdata")).toBeInTheDocument();
  });

  it("does not render the upload form inline when the modal is closed", async () => {
    render(createElement(ProjectsWithoutPPPMonitoringPage));
    // No file input and no allowed-formats text anywhere before the modal opens.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/Allowed formats/)).not.toBeInTheDocument();

    // Open the detail panel only — still no inline form.
    const buttons = Array.from(document.querySelectorAll("button"));
    const rowAction = buttons.find((b) => b.textContent === "Upload");
    await userEvent.click(rowAction!);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/Allowed formats/)).not.toBeInTheDocument();

    // The modal hosts the file input.
    await userEvent.click(screen.getByRole("button", { name: /Upload Masterdata/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Allowed formats: Excel \(\.xlsx, \.xls\) and PDF \(\.pdf\)\. Maximum file size: 150 MB\./)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it("modal shows the selected project context (name, tracking id, formats, size)", async () => {
    const dialog = await openUploadModal();
    expect(within(dialog).getByText("RR18-TEST-001")).toBeInTheDocument(); // Tracking ID row
    expect(within(dialog).getAllByText(/Project RR18-TEST-001/).length).toBeGreaterThan(0); // name (description + row)
    expect(within(dialog).getByText(/Maximum file size: 150 MB\./)).toBeInTheDocument();
  });

  it("Cancel closes the modal", async () => {
    const dialog = await openUploadModal();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape closes the modal when no upload is in progress", async () => {
    await openUploadModal();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a successful upload closes the modal and still invalidates dashboard + detail", async () => {
    const dialog = await openUploadModal();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toContain(".xlsx");

    await userEvent.upload(input, masterdataFile());
    // Selected file details appear inside the modal.
    expect(within(dialog).getByText("masterdata.xlsx")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(mocks.attachInputs.length).toBe(1);
    });
    expect(mocks.attachInputs[0].fileName).toBe("masterdata.xlsx");
    expect(mocks.attachInputs[0].projectId).toBe(1);

    // Modal closes automatically on success.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mocks.dashboardInvalidate).toHaveBeenCalled();
    expect(mocks.detailInvalidate).toHaveBeenCalled();
  });

  it("a failed upload keeps the modal open and displays the error", async () => {
    mocks.attachShouldFail = true;
    const dialog = await openUploadModal();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, masterdataFile());
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(within(dialog).getByText(/simulated upload failure/)).toBeInTheDocument();
    });
    // Modal stays open so the user can retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.dashboardInvalidate).not.toHaveBeenCalled();
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
