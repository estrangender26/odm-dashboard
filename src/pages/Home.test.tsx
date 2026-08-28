// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuthResult: { user: null as { role: string; name: string; avatar?: string } | null, isAuthenticated: false },
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

const BASE_TIME = new Date("2026-08-28T00:00:00.000Z");

function renderHome() {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/", element: createElement(Home) }),
        createElement(Route, {
          path: "/login",
          element: createElement(
            "div",
            null,
            "LOGIN-PAGE-MARKER",
            createElement(Link, { to: "/", id: "return-home" }, "Return home"),
          ),
        }),
      ),
    ),
  );
}

function logoLink() {
  return screen.getByRole("link", { name: /Program Oversight Center/ });
}

function clickLogo(times: number) {
  for (let i = 0; i < times; i += 1) fireEvent.click(logoLink());
}

describe("Home hidden OWNER entry (5 clicks on the logo within a rolling 3s window)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mocks.useAuthResult = { user: null, isAuthenticated: false };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("1 click on the real logo Link does not navigate to /login", () => {
    renderHome();
    clickLogo(1);
    expect(screen.queryByText("LOGIN-PAGE-MARKER")).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard Suite")).toBeInTheDocument();
  });

  it("4 rapid clicks do not navigate to /login", () => {
    renderHome();
    clickLogo(4);
    expect(screen.queryByText("LOGIN-PAGE-MARKER")).not.toBeInTheDocument();
  });

  it("5 clicks within 3 seconds navigate exactly to /login", () => {
    renderHome();
    clickLogo(5);
    expect(screen.getByText("LOGIN-PAGE-MARKER")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard Suite")).not.toBeInTheDocument();
  });

  it("a sequence exceeding 3 seconds resets (old clicks are dropped)", () => {
    renderHome();
    clickLogo(4);
    // >3s later — the 4 earlier clicks fall outside the rolling window.
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 3100));
    clickLogo(1);
    expect(screen.queryByText("LOGIN-PAGE-MARKER")).not.toBeInTheDocument();

    // A fresh valid sequence (5 clicks within 3s) then works.
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 3200));
    clickLogo(4);
    expect(screen.getByText("LOGIN-PAGE-MARKER")).toBeInTheDocument();
  });

  it("after successful activation the state resets and a second valid sequence works", () => {
    renderHome();
    clickLogo(5);
    expect(screen.getByText("LOGIN-PAGE-MARKER")).toBeInTheDocument();

    // Return home (Home remounts with fresh state) and trigger again.
    fireEvent.click(screen.getByRole("link", { name: "Return home" }));
    expect(screen.getByText("Dashboard Suite")).toBeInTheDocument();
    clickLogo(5);
    expect(screen.getByText("LOGIN-PAGE-MARKER")).toBeInTheDocument();
  });

  it("click accumulation is not lost to real React Router Link behavior (no navigation, no clobber)", () => {
    renderHome();
    // With the REAL Link, clicks 1-4 must not navigate anywhere (preventDefault),
    // so no router work can reset the counter before the 5th click lands.
    clickLogo(4);
    expect(screen.queryByText("LOGIN-PAGE-MARKER")).not.toBeInTheDocument();
    // A stale earlier-click scenario: click 4, pause 2.9s (still inside the
    // window), click again — the 5th click within 3s of the 4th must fire.
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 2900));
    clickLogo(1);
    expect(screen.getByText("LOGIN-PAGE-MARKER")).toBeInTheDocument();
  });

  it("the visible top-left logo/title area is the gesture target", () => {
    renderHome();
    const link = logoLink();
    expect(link.querySelector("img[alt='ODM']")).not.toBeNull();
    expect(link.textContent).toContain("Program Oversight Center");
  });

  it("no visible Login/Admin/OWNER/sign-in affordance appears", () => {
    renderHome();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/login/i);
    expect(body).not.toMatch(/admin/i);
    expect(body).not.toMatch(/owner/i);
    expect(body).not.toMatch(/sign in/i);
  });

  it("normal public dashboard content remains intact", () => {
    renderHome();
    expect(screen.getByText("Dashboard Suite")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Post-Planning Insights/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Projects without PPP/ })).toBeInTheDocument();
  });
});
