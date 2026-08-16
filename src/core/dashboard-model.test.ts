import { describe, expect, it } from "vitest";
import type { Task } from "../types.js";
import { buildDashboardModel } from "./dashboard-model.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    parent_id: null,
    name: "Task",
    description: "",
    priority: 1,
    completed: false,
    result: null,
    metadata: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    blockedBy: [],
    blocks: [],
    children: [],
    ...overrides,
  };
}

describe("buildDashboardModel", () => {
  it("partitions tasks into the four dashboard groups", () => {
    const tasks = [
      task({ id: "active", started_at: "2026-01-02T00:00:00.000Z" }),
      task({ id: "ready" }),
      task({ id: "blocker", started_at: "2026-01-01T00:00:00.000Z" }),
      task({ id: "blocked", blockedBy: ["blocker"] }),
      task({
        id: "complete",
        completed: true,
        completed_at: "2026-01-03T00:00:00.000Z",
      }),
    ];

    const model = buildDashboardModel(tasks);

    expect(model.groups.active.tasks.map((item) => item.task.id)).toEqual([
      "active",
      "blocker",
    ]);
    expect(model.groups.ready.tasks.map((item) => item.task.id)).toEqual([
      "ready",
    ]);
    expect(model.groups.blocked.tasks[0]).toMatchObject({
      waitingReason: "blockers",
      incompleteBlockerIds: ["blocker"],
    });
    expect(model.groups.complete.tasks.map((item) => item.task.id)).toEqual([
      "complete",
    ]);
    expect(model.stats).toEqual({
      total: 5,
      pending: 4,
      completed: 1,
      blocked: 1,
      ready: 1,
      inProgress: 2,
    });
  });

  it("describes parents with unfinished children separately from explicit blockers", () => {
    const child = task({ id: "child", parent_id: "parent" });
    const parent = task({ id: "parent", children: ["child"] });

    const model = buildDashboardModel([parent, child]);
    const parentItem = model.groups.blocked.tasks.find(
      (item) => item.task.id === "parent",
    );

    expect(parentItem).toMatchObject({
      waitingReason: "children",
      incompleteChildCount: 1,
      incompleteBlockerIds: [],
    });
    expect(model.groups.ready.tasks[0].task.id).toBe("child");
  });

  it("keeps active status as the primary group even when a task has blockers", () => {
    const blocker = task({ id: "blocker" });
    const active = task({
      id: "active",
      started_at: "2026-01-02T00:00:00.000Z",
      blockedBy: ["blocker"],
    });

    const model = buildDashboardModel([blocker, active]);

    expect(model.groups.active.tasks[0]).toMatchObject({
      waitingReason: "blockers",
      incompleteBlockerIds: ["blocker"],
    });
  });
});
