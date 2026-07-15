import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("Governance upload queue", () => {
  it("never runs more than one FileReader/network task concurrently", async () => {
    const source = await readFile(
      new URL("../public/governance-upload-queue.js", import.meta.url),
      "utf8",
    );
    const context: Record<string, unknown> = {};
    vm.runInNewContext(source, context);
    const createQueue = context.createSequentialTaskQueue as () => (
      task: () => Promise<void>,
    ) => Promise<void>;
    const enqueue = createQueue();
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 4 }, () => enqueue(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    }));
    await Promise.all(tasks);

    expect(maxActive).toBe(1);
  });
});
