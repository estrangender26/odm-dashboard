// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAuthResult: { user: null as { role: string; name: string; avatar?: string } | null, isAuthenticated: false },
}));

vi.mock("react-router", () => ({
  Link: ({ to, children, onClick, ...props }: { to: string; children: React.ReactNode; onClick?: (e: unknown) => void }) =>
    createElement("a", { href: to, onClick, ...props }, children),
  useNavigate: () => mocks.navigate,
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

import Home from "./Home";

function logoLink() {
  return screen.getByRole("link", { name: /Program Oversight Center/ });
}

describe("Home hidden OWNER entry (5 clicks on the logo within 3 seconds)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.navigate.mockReset();
    mocks.useAuthResult = { user: null, isAuthenticated: false };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("1 click on the logo does not navigate", () => {
    render(createElement(Home));
    fireEvent.click(logoLink());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("4 clicks on the logo do not navigate", () => {
    render(createElement(Home));
    for (let i = 0; i < 4; i += 1) fireEvent.click(logoLink());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("5 clicks within 3 seconds navigate to /login", () => {
    render(createElement(Home));
    for (let i = 0; i < 5; i += 1) fireEvent.click(logoLink());
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/login");
  });

  it("the counter resets after the 3-second window expires", () => {
    render(createElement(Home));
    // 4 clicks, then wait past the window: the sequence is broken.
    for (let i = 0; i < 4; i += 1) fireEvent.click(logoLink());
    vi.advanceTimersByTime(3100);
    fireEvent.click(logoLink());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("another valid 5-click sequence works after a reset", () => {
    render(createElement(Home));
    // Broken sequence first.
    for (let i = 0; i < 4; i += 1) fireEvent.click(logoLink());
    vi.advanceTimersByTime(3100);
    fireEvent.click(logoLink());
    expect(mocks.navigate).not.toHaveBeenCalled();

    // Fresh valid sequence.
    for (let i = 0; i < 5; i += 1) fireEvent.click(logoLink());
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/login");
  });

  it("the gesture is invisible: no login/admin/owner hints are rendered", () => {
    render(createElement(Home));
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/login/i);
    expect(body).not.toMatch(/admin/i);
    expect(body).not.toMatch(/owner/i);
    expect(body).not.toMatch(/sign in/i);
  });
});
