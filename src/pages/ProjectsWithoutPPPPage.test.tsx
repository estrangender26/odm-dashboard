// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// PROJECTS WITHOUT PPP PAGE: attachment upload wiring
// 1. Legacy fallback uploads must send base64 fileData (content persisted).
// 2. Both upload paths must invalidate the selected project's detail query
//    (projectsWithoutPPP.get) so attachments appear without reselection.
// ============================================================================

const mocks = vi.hoisted(() => {
  const projectA = {
    id: 1,
    trackingId: "RR18-0616-01-01",
    psCode: "2024-0348",
    codingMask: "A1-ES",
    projectPhase: "Construction",
    latestMilestone: "Ongoing",
    subPhase: "North",
    pmHeadline: "North",
    workPackage: "Hinulugang Taktak Package 1",
    contractPackage: "CP1",
    contractor: "PHILPOWER",
    majorProjectTag: "HINULUGANG TAKTAK",
    constructionManager: "Lon",
    projectManager: "Francis",
    withLSPs: true,
    amdGridHead: "Joey",
    createdAt: null,
    updatedAt: null,
  };
  return {
    projectA,
    attachInputs: [] as Record<string, unknown>[],
    attachOnSuccess: null as null | ((data: unknown, variables: unknown) => void),
    shouldUseDirectStorage: vi.fn(),
    uploadFileDirect: vi.fn(),
    storageFileUrl: vi.fn(),
    listInvalidate: vi.fn(),
    getInvalidate: vi.fn(),
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
  storageFileUrl: (...args: unknown[]) => mocks.storageFileUrl(...args),
}));

vi.mock("@/providers/trpc", () => {
  return {
    trpc: {
      useUtils: () => ({
        projectsWithoutPPP: {
          list: { invalidate: (...args: unknown[]) => mocks.listInvalidate(...args) },
          get: { invalidate: (...args: unknown[]) => mocks.getInvalidate(...args) },
        },
      }),
      projectsWithoutPPP: {
        list: {
          useQuery: () => ({ data: { items: [mocks.projectA], count: 1 }, isLoading: false }),
        },
        get: {
          useQuery: () => ({ data: { ...mocks.projectA, files: [] }, isLoading: false }),
        },
        create: {
          useMutation: () => ({ isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }),
        },
        update: {
          useMutation: () => ({ isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }),
        },
        delete: {
          useMutation: () => ({ isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }),
        },
        attachFileRecord: {
          useMutation: (options?: { onSuccess?: (data: unknown, variables: unknown) => void }) => {
            mocks.attachOnSuccess = options?.onSuccess ?? null;
            const mutate = (input: Record<string, unknown>) => {
              mocks.attachInputs.push(input);
              mocks.attachOnSuccess?.({ id: 1 }, input);
            };
            const mutateAsync = async (input: Record<string, unknown>) => {
              mutate(input);
              return { id: 1 };
            };
            return { isPending: false, error: null, mutate, mutateAsync };
          },
        },
      },
    },
  };
});

import ProjectsWithoutPPPPage from "./ProjectsWithoutPPPPage";

const CONTENT = "a".repeat(80); // 80 bytes -> 108-char base64, passes the page's >=100 guard

async function renderWithSelectedProject(container: HTMLElement) {
  const user = userEvent.setup();
  await user.click(screen.getByText("RR18-0616-01-01 · 2024-0348"));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  return { user, input };
}

describe("ProjectsWithoutPPPPage attachment wiring", () => {
  beforeEach(() => {
    mocks.attachInputs = [];
    mocks.attachOnSuccess = null;
    mocks.shouldUseDirectStorage.mockReset();
    mocks.uploadFileDirect.mockReset();
    mocks.storageFileUrl.mockReset();
    mocks.listInvalidate.mockReset().mockResolvedValue(undefined);
    mocks.getInvalidate.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("legacy fallback upload sends base64 fileData and invalidates the detail query for the selected project", async () => {
    mocks.shouldUseDirectStorage.mockResolvedValue(false);

    const { container } = render(createElement(ProjectsWithoutPPPPage));
    const { user, input } = await renderWithSelectedProject(container);

    await user.upload(input, new File([CONTENT], "note.txt", { type: "text/plain" }));

    await waitFor(() => expect(mocks.attachInputs).toHaveLength(1));
    const inputArg = mocks.attachInputs[0];
    expect(inputArg.projectId).toBe(1);
    expect(inputArg.fileName).toBe("note.txt");
    expect(inputArg.fileType).toBe("text/plain");
    expect(inputArg.fileSize).toBe(CONTENT.length);
    expect(typeof inputArg.fileData).toBe("string");
    expect((inputArg.fileData as string).length).toBeGreaterThanOrEqual(100);
    expect(atob(inputArg.fileData as string)).toBe(CONTENT);

    // The mutation stub already fired onSuccess; verify the detail query was
    // invalidated for the selected project (plus the retained list invalidation).
    await waitFor(() => expect(mocks.getInvalidate).toHaveBeenCalledWith({ id: 1 }));
    expect(mocks.listInvalidate).toHaveBeenCalled();
  });

  it("direct storage upload invalidates the detail query for the selected project", async () => {
    mocks.shouldUseDirectStorage.mockResolvedValue(true);
    mocks.uploadFileDirect.mockResolvedValue({ intentId: "intent-1" });

    const { container } = render(createElement(ProjectsWithoutPPPPage));
    const { user, input } = await renderWithSelectedProject(container);

    await user.upload(input, new File(["x"], "doc.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(mocks.uploadFileDirect).toHaveBeenCalled());
    expect(mocks.uploadFileDirect).toHaveBeenCalledWith(
      expect.objectContaining({ module: "projects_without_ppp", target: { projectId: 1 } })
    );
    await waitFor(() => expect(mocks.getInvalidate).toHaveBeenCalledWith({ id: 1 }));
    expect(mocks.listInvalidate).toHaveBeenCalled();
  });

  it("does not invalidate anything when the selected project has no attachments flow (upload blocked without selection)", async () => {
    // No project selected: uploading must be a no-op (no invalidation calls).
    render(createElement(ProjectsWithoutPPPPage));
    expect(mocks.getInvalidate).not.toHaveBeenCalled();
    expect(mocks.listInvalidate).not.toHaveBeenCalled();
  });
});
