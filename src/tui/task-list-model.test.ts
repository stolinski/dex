import { describe, expect, it } from "vitest";
import type { Task } from "../types.js";
import {
  buildDashboardModel,
  type DashboardGroupId,
} from "../core/dashboard-model.js";
import { buildTaskListRows } from "./task-list-model.js";

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

const defaultCollapsedGroups = new Set<DashboardGroupId>(["complete"]);

describe("buildTaskListRows", () => {
  it("groups tasks by parent epic inside each status section", () => {
    const model = buildDashboardModel([
      task({ id: "epic", name: "Epic", children: ["active", "ready"] }),
      task({
        id: "active",
        parent_id: "epic",
        started_at: "2026-01-02T00:00:00.000Z",
      }),
      task({ id: "ready", parent_id: "epic" }),
      task({ id: "standalone", priority: 2 }),
    ]);

    const rows = buildTaskListRows(model, {
      collapsedGroups: defaultCollapsedGroups,
      collapsedEpicKeys: new Set(),
    });

    expect(rows.map((row) => row.key)).toEqual([
      "group:active",
      "epic:active:epic",
      "task:active",
      "group:ready",
      "epic:ready:epic",
      "task:ready",
      "task:standalone",
      "group:blocked",
      "epic:blocked:epic",
      "group:complete",
    ]);
    expect(rows.find((row) => row.key === "epic:active:epic")).toMatchObject({
      type: "epic",
      childCount: 1,
      hasChildren: true,
    });
    expect(rows.find((row) => row.key === "epic:blocked:epic")).toMatchObject({
      type: "epic",
      childCount: 0,
      hasChildren: false,
    });
  });

  it("folds an epic independently within each status", () => {
    const model = buildDashboardModel([
      task({ id: "epic", children: ["active", "ready"] }),
      task({
        id: "active",
        parent_id: "epic",
        started_at: "2026-01-02T00:00:00.000Z",
      }),
      task({ id: "ready", parent_id: "epic" }),
    ]);

    const rows = buildTaskListRows(model, {
      collapsedGroups: defaultCollapsedGroups,
      collapsedEpicKeys: new Set(["epic:active:epic"]),
    });

    expect(rows.map((row) => row.key)).not.toContain("task:active");
    expect(rows.map((row) => row.key)).toContain("task:ready");
  });

  it("keeps status groups independently foldable", () => {
    const model = buildDashboardModel([task({ id: "ready" })]);

    const rows = buildTaskListRows(model, {
      collapsedGroups: new Set<DashboardGroupId>(["ready", "complete"]),
      collapsedEpicKeys: new Set(),
    });

    expect(rows.map((row) => row.key)).toEqual([
      "group:active",
      "group:ready",
      "group:blocked",
      "group:complete",
    ]);
  });
});
