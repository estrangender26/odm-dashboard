import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LagInput } from "./DependencyPanel";

describe("DependencyPanel lag input", () => {
  it("is controlled by the current server/cache lag value", () => {
    const dependency = { id: 7, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS" as const, lagDays: 9 };
    const optimistic = renderToStaticMarkup(createElement(LagInput, { dependency, disabled: false, onCommit: () => undefined }));
    const rolledBack = renderToStaticMarkup(createElement(LagInput, { dependency: { ...dependency, lagDays: 3 }, disabled: false, onCommit: () => undefined }));
    expect(optimistic).toContain('value="9"');
    expect(rolledBack).toContain('value="3"');
  });
});
