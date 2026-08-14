import { describe, expect, it, vi } from "vitest";
import {
  buildDestinationFolderTree,
  createSubmissionGuard,
  createTrailingAsyncCoordinator,
  getDestinationFolderOptions,
  type DestinationFolderRow,
} from "./om-manual-moves";

const folderRows: DestinationFolderRow[] = [
  { id: 1, name: "Plant", parentId: null, sortOrder: 0 },
  { id: 2, name: "Pumps", parentId: 1, sortOrder: 0 },
  { id: 3, name: "Electrical", parentId: 2, sortOrder: 0 },
  { id: 4, name: "Remote Site", parentId: null, sortOrder: 1 },
];

describe("O&M move destination folders", () => {
  it("builds and renders nested folder-only destinations", () => {
    const tree = buildDestinationFolderTree(folderRows);

    expect(tree).toHaveLength(2);
    expect(tree[0].children[0].children[0]).toMatchObject({
      id: 3,
      name: "Electrical",
    });
    expect(getDestinationFolderOptions(tree)).toEqual([
      { id: 1, label: "Plant" },
      { id: 2, label: "Plant / Pumps" },
      { id: 3, label: "Plant / Pumps / Electrical" },
      { id: 4, label: "Remote Site" },
    ]);
  });

  it("keeps a moving folder and all descendants out of its destination list", () => {
    const options = getDestinationFolderOptions(
      buildDestinationFolderTree(folderRows),
      2,
    );

    expect(options).toEqual([
      { id: 1, label: "Plant" },
      { id: 4, label: "Remote Site" },
    ]);
  });
});

describe("O&M move submission guard", () => {
  it("rejects duplicate rapid submissions until the pending move settles", () => {
    const guard = createSubmissionGuard();

    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    expect(guard.isPending()).toBe(true);

    guard.finish();

    expect(guard.isPending()).toBe(false);
    expect(guard.tryStart()).toBe(true);
  });
});

describe("O&M post-move refresh coalescing", () => {
  it("bounds rapid requests to one active plus one trailing refresh and applies final state", async () => {
    let releaseFirstRefresh!: () => void;
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let serverState = {
      folders: ["Plant", "Pumps"],
      files: ["manual-a.pdf"],
    };
    let visibleState = { folders: [] as string[], files: [] as string[] };
    let activeRefreshes = 0;
    let maximumActiveRefreshes = 0;
    let refreshCount = 0;
    const refreshActions: string[] = [];

    const refresh = vi.fn(async (action: string) => {
      refreshActions.push(action);
      refreshCount += 1;
      activeRefreshes += 1;
      maximumActiveRefreshes = Math.max(maximumActiveRefreshes, activeRefreshes);
      const snapshot = structuredClone(serverState);
      if (refreshCount === 1) await firstRefreshGate;
      visibleState = snapshot;
      activeRefreshes -= 1;
    });
    const coordinator = createTrailingAsyncCoordinator(refresh);

    const first = coordinator.request("move-file-1");
    serverState = {
      folders: ["Plant", "Pumps", "Electrical"],
      files: ["manual-a.pdf"],
    };
    const second = coordinator.request("move-folder-2");
    serverState = {
      folders: ["Plant", "Pumps", "Electrical"],
      files: ["manual-a.pdf", "manual-b.pdf"],
    };
    const third = coordinator.request("move-file-3");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coordinator.isRunning()).toBe(true);

    releaseFirstRefresh();
    await Promise.all([first, second, third]);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refreshActions).toEqual(["move-file-1", "move-file-3"]);
    expect(maximumActiveRefreshes).toBe(1);
    expect(visibleState).toEqual(serverState);
    expect(coordinator.isRunning()).toBe(false);
  });
});
