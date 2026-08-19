import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    createElement("a", { href: to, ...props }, children),
}));

vi.mock("@/components/ProgramsEngineeringLogo", () => ({
  default: (props: { size?: number }) => createElement("img", { src: "/programs_engineering_vertical_logo.svg", alt: "ODM", ...props }),
}));

import GanttLandingPage from "./GanttLandingPage";

describe("GanttLandingPage header", () => {
  it("renders the standard ODM logo as the single Dashboard Home link", () => {
    const html = renderToStaticMarkup(createElement(GanttLandingPage));
    expect(html).toContain("programs_engineering_vertical_logo.svg");
    expect(html).toContain('aria-label="Dashboard Home"');
    expect(html).toContain('title="Dashboard Home"');
    expect(html).toContain('href="/"');
    const homeLinkCount = (html.match(/aria-label="Dashboard Home"/g) || []).length;
    expect(homeLinkCount).toBe(1);
  });

  it("keeps the existing page content", () => {
    const html = renderToStaticMarkup(createElement(GanttLandingPage));
    expect(html).toContain("ODM Primavera Lite Online");
    expect(html).toContain("Create New Project");
    expect(html).toContain("My Projects");
  });
});
