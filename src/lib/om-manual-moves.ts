export interface DestinationFolderRow {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number | null;
}

export interface DestinationFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  children: DestinationFolder[];
}

export interface DestinationFolderOption {
  id: number;
  label: string;
}

export function buildDestinationFolderTree(rows: DestinationFolderRow[]): DestinationFolder[] {
  const rowById = new Map(rows.map((row) => [row.id, row] as const));
  const safeParentById = new Map<number, number | null>();

  for (const row of rows) {
    if (row.parentId === null || row.parentId === row.id || !rowById.has(row.parentId)) {
      safeParentById.set(row.id, null);
      continue;
    }

    const visited = new Set<number>([row.id]);
    let parentId: number | null = row.parentId;
    let isSafe = true;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        isSafe = false;
        break;
      }
      visited.add(parentId);
      parentId = rowById.get(parentId)?.parentId ?? null;
    }
    safeParentById.set(row.id, isSafe ? row.parentId : null);
  }

  const childrenByParentId = new Map<number | null, DestinationFolderRow[]>();
  for (const row of rows) {
    const parentId = safeParentById.get(row.id) ?? null;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(row);
    childrenByParentId.set(parentId, siblings);
  }

  function walk(parentId: number | null, visited: Set<number>): DestinationFolder[] {
    return [...(childrenByParentId.get(parentId) ?? [])]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
      .flatMap((row) => {
        if (visited.has(row.id)) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(row.id);
        return [{
          id: row.id,
          name: row.name,
          parentId: safeParentById.get(row.id) ?? null,
          sortOrder: row.sortOrder ?? 0,
          children: walk(row.id, nextVisited),
        }];
      });
  }

  return walk(null, new Set<number>());
}

export function getDestinationFolderOptions(
  folders: DestinationFolder[],
  movingFolderId?: number,
): DestinationFolderOption[] {
  const excludedIds = new Set<number>();

  function excludeSubtree(nodes: DestinationFolder[]): boolean {
    for (const node of nodes) {
      if (node.id === movingFolderId) {
        const collect = (folder: DestinationFolder) => {
          excludedIds.add(folder.id);
          folder.children.forEach(collect);
        };
        collect(node);
        return true;
      }
      if (excludeSubtree(node.children)) return true;
    }
    return false;
  }

  if (movingFolderId !== undefined) excludeSubtree(folders);

  const options: DestinationFolderOption[] = [];
  function walk(nodes: DestinationFolder[], path: string[]) {
    for (const node of nodes) {
      const nextPath = [...path, node.name];
      if (!excludedIds.has(node.id)) {
        options.push({ id: node.id, label: nextPath.join(" / ") });
      }
      walk(node.children, nextPath);
    }
  }
  walk(folders, []);
  return options;
}

export interface SubmissionGuard {
  tryStart: () => boolean;
  finish: () => void;
  isPending: () => boolean;
}

export function createSubmissionGuard(): SubmissionGuard {
  let pending = false;
  return {
    tryStart() {
      if (pending) return false;
      pending = true;
      return true;
    },
    finish() {
      pending = false;
    },
    isPending() {
      return pending;
    },
  };
}

export interface TrailingAsyncCoordinator<T> {
  request: (value: T) => Promise<void>;
  isRunning: () => boolean;
}

/**
 * Runs at most one task at a time. Requests received during a run are folded
 * into one trailing run with the latest value, so the final request is never
 * dropped.
 *
 * The settled outcome reflects the final run only: if an earlier run fails but
 * a later trailing run succeeds, the shared promise resolves, because the last
 * run is what brought the UI to its final correct state. If the final run
 * fails, the shared promise rejects with that run's error.
 */
export function createTrailingAsyncCoordinator<T>(
  run: (value: T) => Promise<void>,
): TrailingAsyncCoordinator<T> {
  let running: Promise<void> | null = null;
  let trailingRequested = false;
  let latestValue: T;

  return {
    request(value) {
      latestValue = value;
      trailingRequested = true;

      if (!running) {
        running = (async () => {
          let finalFailed = false;
          let finalError: unknown;
          try {
            do {
              trailingRequested = false;
              const valueForRun = latestValue;
              try {
                await run(valueForRun);
                finalFailed = false;
                finalError = undefined;
              } catch (error) {
                finalFailed = true;
                finalError = error;
              }
            } while (trailingRequested);

            if (finalFailed) throw finalError;
          } finally {
            running = null;
          }
        })();
      }

      return running;
    },
    isRunning() {
      return running !== null;
    },
  };
}
