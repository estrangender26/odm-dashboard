import { describe, expect, it } from "vitest";
import { odmTalkBridgeInputSchema, requiresApprovalForThreadType } from "./ai-assistant-bridge";

const validPayload = {
  sourceModule: "Maintenance Planning",
  sourcePage: "/maintenance-planning",
  sourceRecordId: "task-123",
  sourceUrl: "/maintenance-planning?record=task-123",
  assistantName: "Maintenance Planning AI",
  content: "AI Generated recommendation",
};

describe("ODM Talk bridge validation", () => {
  it("accepts internal source URLs", () => {
    expect(odmTalkBridgeInputSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects external and unsafe source URLs", () => {
    for (const sourceUrl of ["https://example.com/task-123", "javascript:alert(1)", "//example.com/task-123"]) {
      expect(odmTalkBridgeInputSchema.safeParse({ ...validPayload, sourceUrl }).success).toBe(false);
    }
  });

  it("uses one decision-thread approval rule", () => {
    expect(requiresApprovalForThreadType("Post-PPP Decision")).toBe(1);
    expect(requiresApprovalForThreadType("Decision Review")).toBe(1);
    expect(requiresApprovalForThreadType("General Discussion")).toBe(0);
    expect(requiresApprovalForThreadType(null)).toBe(0);
    expect(requiresApprovalForThreadType(undefined)).toBe(0);
  });
});
