// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCalendar } from "./CalendarPanel";

interface Captured {
  calendar?: unknown;
  calendarId?: number;
  exceptionId?: number;
  exception?: unknown;
  changes?: unknown;
  expectedRevision?: number;
}

const captured: {
  create: Captured[];
  update: Captured[];
  setDefault: Captured[];
  createEx: Captured[];
  updateEx: Captured[];
  deleteEx: Captured[];
} = {
  create: [],
  update: [],
  setDefault: [],
  createEx: [],
  updateEx: [],
  deleteEx: [],
};

function createMutationStub(bucket: Captured[], fail = false) {
  return (opts?: { onSuccess?: (res: unknown) => void; onError?: (err: { message: string }) => void }) => {
    const [isPending] = useState(false);
    const mutate = (input: Captured) => {
      bucket.push(input);
      if (fail) opts?.onError?.({ message: "Mutation failed" });
      else opts?.onSuccess?.({ revision: 4 });
    };
    const mutateAsync = async (input: Captured) => {
      bucket.push(input);
      if (fail) throw new Error("Mutation failed");
      return { revision: 4 };
    };
    return { isPending, error: fail ? new Error("Mutation failed") : null, mutate, mutateAsync };
  };
}

vi.mock("@/providers/trpc", () => {
  return {
    trpc: {
      Provider: ({ children }: { children: ReactNode }) => children,
      primaveraLite: new Proxy(
        {},
        {
          get(_target: unknown, prop: string) {
            if (prop === "createCalendar") return { useMutation: createMutationStub(captured.create) };
            if (prop === "updateCalendar") return { useMutation: createMutationStub(captured.update) };
            if (prop === "setProjectDefaultCalendar") return { useMutation: createMutationStub(captured.setDefault) };
            if (prop === "createCalendarException") return { useMutation: createMutationStub(captured.createEx) };
            if (prop === "updateCalendarException") return { useMutation: createMutationStub(captured.updateEx) };
            if (prop === "deleteCalendarException") return { useMutation: createMutationStub(captured.deleteEx) };
            return { useQuery: () => ({ data: undefined }), useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
          },
        }
      ),
    },
  };
});

import CalendarPanel from "./CalendarPanel";

const calendars: ProjectCalendar[] = [
  {
    id: 1,
    name: "Default Calendar",
    workingDays: [1, 2, 3, 4, 5],
    exceptions: [{ id: 9, calendarId: 1, exceptionDate: "2026-08-17", isWorking: false, description: "Holiday" }],
  },
  { id: 2, name: "Weekend Crew", workingDays: [6, 0], exceptions: [] },
];

function renderPanel(role: "admin" | "editor" | "viewer") {
  return render(
    <CalendarPanel
      slug="test-project"
      access="token"
      role={role}
      expectedRevision={3}
      defaultCalendarId={1}
      calendars={calendars}
      activities={[{ calendarId: 2, archivedAt: null }, { calendarId: 2, archivedAt: null }]}
      onRevisionChange={() => undefined}
      onRefresh={() => undefined}
    />
  );
}

afterEach(() => cleanup());
beforeEach(() => {
  captured.create.length = 0;
  captured.update.length = 0;
  captured.setDefault.length = 0;
  captured.createEx.length = 0;
  captured.updateEx.length = 0;
  captured.deleteEx.length = 0;
});

describe("CalendarPanel", () => {
  it("lists calendars with weekday labels, default badge, and usage count", () => {
    renderPanel("viewer");
    expect(screen.getByText("Default Calendar")).toBeInTheDocument();
    expect(screen.getByText("Weekend Crew")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Mon, Tue, Wed, Thu, Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat, Sun")).toBeInTheDocument();
    expect(screen.getByText("2 active activities")).toBeInTheDocument();
    expect(screen.getByText("2026-08-17")).toBeInTheDocument();
    expect(screen.getByText("Non-working")).toBeInTheDocument();
  });

  it("is read-only for viewers", () => {
    renderPanel("viewer");
    expect(screen.queryByText("Add Calendar")).not.toBeInTheDocument();
    expect(screen.queryByText("Set as Default")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Add exception")).not.toBeInTheDocument();
  });

  it("lets an editor create a calendar", async () => {
    renderPanel("editor");
    await userEvent.click(screen.getByText("Add Calendar"));
    await userEvent.type(screen.getByLabelText("New calendar name"), "Night Shift");
    await userEvent.click(screen.getByRole("button", { name: "Save Calendar" }));
    expect(captured.create).toHaveLength(1);
    expect(captured.create[0]).toMatchObject({
      slug: "test-project",
      expectedRevision: 3,
      calendar: { name: "Night Shift", workingDays: [1, 2, 3, 4, 5] },
    });
  });

  it("lets an editor edit name and working days", async () => {
    renderPanel("editor");
    await userEvent.click(screen.getAllByText("Edit")[0]);
    const name = screen.getByLabelText("Calendar name");
    await userEvent.clear(name);
    await userEvent.type(name, "Std Week");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(captured.update).toHaveLength(1);
    expect(captured.update[0]).toMatchObject({
      calendarId: 1,
      changes: { name: "Std Week" },
    });
  });

  it("shows Set as Default only for admin and not on the current default", () => {
    renderPanel("admin");
    expect(screen.getByText("Set as Default")).toBeInTheDocument();
    cleanup();
    renderPanel("editor");
    expect(screen.queryByText("Set as Default")).not.toBeInTheDocument();
  });

  it("admin can set default", async () => {
    renderPanel("admin");
    await userEvent.click(screen.getByText("Set as Default"));
    expect(captured.setDefault).toHaveLength(1);
    expect(captured.setDefault[0]).toMatchObject({ calendarId: 2, expectedRevision: 3 });
  });

  it("adds, edits, and deletes exceptions", async () => {
    renderPanel("editor");
    await userEvent.click(screen.getAllByText("Add exception")[0]);
    await userEvent.type(screen.getByLabelText("Exception date"), "2026-12-25");
    await userEvent.type(screen.getByLabelText("Exception description"), "Christmas");
    await userEvent.click(screen.getByRole("button", { name: "Save new exception" }));
    expect(captured.createEx[0]).toMatchObject({
      calendarId: 1,
      exception: { exceptionDate: "2026-12-25", isWorking: false, description: "Christmas" },
    });

    await userEvent.click(screen.getByText("Edit exception"));
    await userEvent.click(screen.getByRole("button", { name: "Save exception" }));
    expect(captured.updateEx).toHaveLength(1);
    expect(captured.updateEx[0]).toMatchObject({ exceptionId: 9 });

    await userEvent.click(screen.getByText("Delete exception"));
    expect(captured.deleteEx).toHaveLength(1);
    expect(captured.deleteEx[0]).toMatchObject({ exceptionId: 9 });
  });
});
