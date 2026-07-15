import { describe, expect, it } from "vitest";
import type { GanttScope } from "./gantt-scope";
import { ganttScopeOwnsProject } from "./gantt-scope";
import { validateDependencyGraph, validateHierarchyAssignment } from "./gantt-domain";

type MemoryTask = {
  id: number;
  name: string;
  parentId: number | null;
  taskType: "task" | "milestone" | "summary" | "project";
  category: string | null;
  sortOrder: number;
  plannedStart: string | null;
  plannedEnd: string | null;
};

type MemoryDependency = {
  predecessorTaskId: number;
  successorTaskId: number;
  relationshipType: "FS" | "SS" | "FF" | "SF";
  lag: number;
};

type MemoryProject = {
  id: number;
  name: string;
  userId: number | null;
  sessionId: string | null;
  tasks: MemoryTask[];
  dependencies: MemoryDependency[];
  assignments: Array<{ taskId: number; resourceId: string; units: number }>;
};

class MemoryGanttStore {
  constructor(readonly projects: MemoryProject[]) {}

  private project(scope: GanttScope, projectId: number) {
    const project = this.projects.find(candidate => candidate.id === projectId);
    if (!project || !ganttScopeOwnsProject(scope, project)) throw new Error("Project not found");
    return project;
  }

  private transaction<T>(operation: (draft: MemoryProject[]) => T): T {
    const draft = structuredClone(this.projects);
    const result = operation(draft);
    this.projects.splice(0, this.projects.length, ...draft);
    return result;
  }

  list(scope: GanttScope) {
    return this.projects.filter(project => ganttScopeOwnsProject(scope, project)).map(project => project.id);
  }

  open(scope: GanttScope, projectId: number) {
    return structuredClone(this.project(scope, projectId));
  }

  updateProject(scope: GanttScope, projectId: number, name: string, fail = false) {
    return this.transaction(draft => {
      const project = new MemoryGanttStore(draft).project(scope, projectId);
      project.name = name;
      if (fail) throw new Error("injected project failure");
      return project.name;
    });
  }

  saveTask(scope: GanttScope, projectId: number, task: MemoryTask) {
    return this.transaction(draft => {
      const project = new MemoryGanttStore(draft).project(scope, projectId);
      validateHierarchyAssignment(project.tasks, task.id, task.parentId);
      const index = project.tasks.findIndex(candidate => candidate.id === task.id);
      if (index < 0) throw new Error("Task not found");
      project.tasks[index] = structuredClone(task);
    });
  }

  replaceDependencies(scope: GanttScope, projectId: number, dependencies: MemoryDependency[]) {
    return this.transaction(draft => {
      const project = new MemoryGanttStore(draft).project(scope, projectId);
      validateDependencyGraph(project.tasks.map(task => task.id), dependencies);
      project.dependencies = structuredClone(dependencies);
    });
  }

  updateHierarchy(scope: GanttScope, projectId: number, taskId: number, parentId: number | null) {
    return this.transaction(draft => {
      const project = new MemoryGanttStore(draft).project(scope, projectId);
      validateHierarchyAssignment(project.tasks, taskId, parentId);
      const task = project.tasks.find(candidate => candidate.id === taskId);
      if (!task) throw new Error("Task not found");
      task.parentId = parentId;
    });
  }

  importPlan(scope: GanttScope, projectId: number, plan: Omit<MemoryProject, "id" | "name" | "userId" | "sessionId">, failAfterTasks = false) {
    return this.transaction(draft => {
      const project = new MemoryGanttStore(draft).project(scope, projectId);
      for (const task of plan.tasks) validateHierarchyAssignment(plan.tasks, task.id, task.parentId);
      validateDependencyGraph(plan.tasks.map(task => task.id), plan.dependencies);
      project.tasks = structuredClone(plan.tasks);
      if (failAfterTasks) throw new Error("injected import failure");
      project.dependencies = structuredClone(plan.dependencies);
      for (const assignment of plan.assignments) {
        if (!project.tasks.some(task => task.id === assignment.taskId)) throw new Error("Assignment task unavailable");
      }
      project.assignments = structuredClone(plan.assignments);
    });
  }
}

const userA = { kind: "user", userId: 1, isAdmin: false } as const;
const userB = { kind: "user", userId: 2, isAdmin: false } as const;
const anonA = { kind: "anonymous", sessionId: "anon-a", isAdmin: false } as const;
const anonB = { kind: "anonymous", sessionId: "anon-b", isAdmin: false } as const;

function task(id: number, parentId: number | null = null): MemoryTask {
  return {
    id,
    name: `Task ${id}`,
    parentId,
    taskType: "task",
    category: null,
    sortOrder: id,
    plannedStart: "2026-08-01",
    plannedEnd: "2026-08-02",
  };
}

function fixture() {
  return new MemoryGanttStore([
    { id: 1, name: "A", userId: 1, sessionId: null, tasks: [task(1), task(2)], dependencies: [], assignments: [] },
    { id: 2, name: "B", userId: 2, sessionId: null, tasks: [task(10)], dependencies: [], assignments: [] },
    { id: 3, name: "Anon A", userId: null, sessionId: "anon-a", tasks: [], dependencies: [], assignments: [] },
    { id: 4, name: "Anon B", userId: null, sessionId: "anon-b", tasks: [], dependencies: [], assignments: [] },
  ]);
}

describe("Gantt Phase 0 isolated repository behavior", () => {
  it("isolates lists and manual project IDs across users and anonymous sessions", () => {
    const store = fixture();
    expect(store.list(userA)).toEqual([1]);
    expect(store.list(userB)).toEqual([2]);
    expect(store.list(anonA)).toEqual([3]);
    expect(store.list(anonB)).toEqual([4]);
    expect(() => store.open(userA, 2)).toThrow("Project not found");
    expect(() => store.open(anonA, 4)).toThrow("Project not found");
    expect(() => store.open(anonA, 1)).toThrow("Project not found");
  });

  it("blocks cross-user task, dependency, hierarchy, and import mutations", () => {
    const store = fixture();
    expect(() => store.saveTask(userA, 2, task(10))).toThrow("Project not found");
    expect(() => store.replaceDependencies(userA, 2, [])).toThrow("Project not found");
    expect(() => store.updateHierarchy(userA, 2, 10, null)).toThrow("Project not found");
    expect(() => store.importPlan(userA, 2, { tasks: [], dependencies: [], assignments: [] })).toThrow("Project not found");
  });

  it("rolls back failed project saves and failed imports", () => {
    const store = fixture();
    const before = structuredClone(store.projects);
    expect(() => store.updateProject(userA, 1, "Changed", true)).toThrow("injected project failure");
    expect(store.projects).toEqual(before);
    expect(() => store.importPlan(userA, 1, {
      tasks: [task(20)],
      dependencies: [],
      assignments: [],
    }, true)).toThrow("injected import failure");
    expect(store.projects).toEqual(before);
  });

  it("keeps valid links and parents when dependency or hierarchy validation fails", () => {
    const store = fixture();
    store.replaceDependencies(userA, 1, [{ predecessorTaskId: 1, successorTaskId: 2, relationshipType: "FS", lag: 0 }]);
    const before = structuredClone(store.open(userA, 1));
    expect(() => store.replaceDependencies(userA, 1, [
      { predecessorTaskId: 1, successorTaskId: 2, relationshipType: "FS", lag: 0 },
      { predecessorTaskId: 2, successorTaskId: 1, relationshipType: "SS", lag: 0 },
    ])).toThrow("Dependency cycle detected");
    expect(() => store.updateHierarchy(userA, 1, 1, 99)).toThrow("unavailable");
    expect(store.open(userA, 1)).toEqual(before);
  });

  it("rolls back assignments and all imported tasks on a late import failure", () => {
    const store = fixture();
    const before = structuredClone(store.open(userA, 1));
    expect(() => store.importPlan(userA, 1, {
      tasks: [task(20)],
      dependencies: [],
      assignments: [{ taskId: 999, resourceId: "missing", units: 1 }],
    })).toThrow("Assignment task unavailable");
    expect(store.open(userA, 1)).toEqual(before);
  });

  it("opens empty and populated projects without modifying any project", async () => {
    const store = fixture();
    const before = structuredClone(store.projects);
    expect(store.open(anonA, 3).tasks).toEqual([]);
    const [a, b] = await Promise.all([
      Promise.resolve(store.open(userA, 1)),
      Promise.resolve(store.open(userB, 2)),
    ]);
    expect(a.name).toBe("A");
    expect(b.name).toBe("B");
    expect(store.projects).toEqual(before);
  });

  it("round-trips canonical normalized properties", () => {
    const store = fixture();
    const plan = {
      tasks: [
        { ...task(20), name: "Summary", taskType: "summary" as const, category: "Civil", sortOrder: 1 },
        { ...task(21, 20), name: "Gate", taskType: "milestone" as const, category: "Gate", sortOrder: 2, plannedEnd: "2026-08-01" },
        { ...task(22, 20), name: "Work", taskType: "task" as const, category: "Mechanical", sortOrder: 3 },
      ],
      dependencies: [
        { predecessorTaskId: 20, successorTaskId: 22, relationshipType: "SS" as const, lag: 1 },
        { predecessorTaskId: 21, successorTaskId: 22, relationshipType: "FF" as const, lag: -1 },
      ],
      assignments: [{ taskId: 22, resourceId: "crew-a", units: 0.5 }],
    };
    store.importPlan(userA, 1, plan);
    expect(JSON.parse(JSON.stringify(store.open(userA, 1)))).toMatchObject(plan);
  });
});
