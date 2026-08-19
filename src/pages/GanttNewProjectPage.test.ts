import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    createElement("a", { href: to, ...props }, children),
  useNavigate: () => () => undefined,
  useHref: (to: string) => to,
}));

vi.mock("@/components/ProgramsEngineeringLogo", () => ({
  default: (props: { size?: number }) => createElement("img", { src: "/programs_engineering_vertical_logo.svg", alt: "ODM", ...props }),
}));

vi.mock("@/providers/trpc", () => ({
  trpc: {
    primaveraLite: {
      createProject: {
        useMutation: () => ({ isPending: false, error: null, mutate: () => undefined, mutateAsync: async () => ({}) }),
      },
    },
    useUtils: () => ({}),
  },
}));

import GanttNewProjectPage from "./GanttNewProjectPage";

describe("GanttNewProjectPage header", () => {
  it("renders the standard ODM logo as the single Dashboard Home link", () => {
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined };
    const html = renderToStaticMarkup(createElement(GanttNewProjectPage));
    expect(html).toContain("programs_engineering_vertical_logo.svg");
    expect(html).toContain('aria-label="Dashboard Home"');
    expect(html).toContain('title="Dashboard Home"');
    expect(html).toContain('href="/"');
    const homeLinkCount = (html.match(/aria-label="Dashboard Home"/g) || []).length;
    expect(homeLinkCount).toBe(1);
  });

  it("keeps the existing create-project form", () => {
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined };
    const html = renderToStaticMarkup(createElement(GanttNewProjectPage));
    expect(html).toContain("Create Primavera Lite Project");
    expect(html).toContain("Project name");
    expect(html).toContain("Create Project");
  });
});
