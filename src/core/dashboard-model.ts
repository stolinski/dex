import type { Task } from "../types.js";
import { isInProgress } from "./task-relationships.js";

export type DashboardGroupId = "active" | "ready" | "blocked" | "complete";
export type WaitingReason = "blockers" | "children" | null;

export interface DashboardTask {
  task: Task;
  incompleteBlockerIds: string[];
  incompleteChildCount: number;
  waitingReason: WaitingReason;
}

export interface DashboardGroup {
  id: DashboardGroupId;
  label: string;
  tasks: DashboardTask[];
}

export interface DashboardStats {
  total: number;
  pending: number;
  completed: number;
  blocked: number;
  ready: number;
  inProgress: number;
}

export interface DashboardModel {
  stats: DashboardStats;
  groups: Record<DashboardGroupId, DashboardGroup>;
}

function priorityThenId(a: DashboardTask, b: DashboardTask): number {
  if (a.task.priority !== b.task.priority) {
    return a.task.priority - b.task.priority;
  }
  return a.task.id.localeCompare(b.task.id);
}

export function buildDashboardModel(tasks: Task[]): DashboardModel {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const active: DashboardTask[] = [];
  const ready: DashboardTask[] = [];
  const blocked: DashboardTask[] = [];
  const complete: DashboardTask[] = [];

  for (const task of tasks) {
    const incompleteBlockerIds = task.blockedBy.filter((blockerId) => {
      const blocker = byId.get(blockerId);
      return blocker !== undefined && !blocker.completed;
    });
    const incompleteChildCount = task.children.reduce((count, childId) => {
      const child = byId.get(childId);
      return count + (child && !child.completed ? 1 : 0);
    }, 0);
    const waitingReason: WaitingReason =
      incompleteBlockerIds.length > 0
        ? "blockers"
        : incompleteChildCount > 0
          ? "children"
          : null;
    const item = {
      task,
      incompleteBlockerIds,
      incompleteChildCount,
      waitingReason,
    };

    if (task.completed) {
      complete.push(item);
    } else if (isInProgress(task)) {
      active.push(item);
    } else if (waitingReason) {
      blocked.push(item);
    } else {
      ready.push(item);
    }
  }

  active.sort((a, b) => {
    const byStarted = (b.task.started_at ?? "").localeCompare(
      a.task.started_at ?? "",
    );
    return byStarted || a.task.id.localeCompare(b.task.id);
  });
  ready.sort(priorityThenId);
  blocked.sort(priorityThenId);
  complete.sort((a, b) => {
    const byCompleted = (b.task.completed_at ?? "").localeCompare(
      a.task.completed_at ?? "",
    );
    return byCompleted || a.task.id.localeCompare(b.task.id);
  });

  const pending = tasks.filter((task) => !task.completed).length;
  return {
    stats: {
      total: tasks.length,
      pending,
      completed: complete.length,
      blocked: blocked.length,
      ready: ready.length,
      inProgress: active.length,
    },
    groups: {
      active: { id: "active", label: "Active", tasks: active },
      ready: { id: "ready", label: "Ready", tasks: ready },
      blocked: { id: "blocked", label: "Blocked", tasks: blocked },
      complete: { id: "complete", label: "Complete", tasks: complete },
    },
  };
}
