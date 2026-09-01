import type {
  DashboardGroupId,
  DashboardModel,
  DashboardTask,
} from "../core/dashboard-model.js";

export type TaskListRow =
  | { key: string; type: "group"; groupId: DashboardGroupId }
  | {
      key: string;
      type: "epic";
      groupId: DashboardGroupId;
      item: DashboardTask;
      childCount: number;
      hasChildren: boolean;
    }
  | {
      key: string;
      type: "task";
      groupId: DashboardGroupId;
      item: DashboardTask;
      epicKey: string | null;
      treePrefix: string;
    };

interface BuildTaskListRowsOptions {
  collapsedGroups: ReadonlySet<DashboardGroupId>;
  collapsedEpicKeys: ReadonlySet<string>;
}

type DashboardEntry = {
  groupId: DashboardGroupId;
  item: DashboardTask;
};

type GroupUnit =
  | { type: "task"; item: DashboardTask }
  | { type: "epic"; root: DashboardTask; items: DashboardTask[] };

const GROUP_ORDER: DashboardGroupId[] = [
  "active",
  "ready",
  "blocked",
  "complete",
];

function findEpicRoot(
  item: DashboardTask,
  entryById: ReadonlyMap<string, DashboardEntry>,
  parentIds: ReadonlySet<string>,
): DashboardTask | null {
  let current = item;
  const visited = new Set([item.task.id]);

  while (current.task.parent_id) {
    const parent = entryById.get(current.task.parent_id)?.item;
    if (!parent || visited.has(parent.task.id)) return null;
    visited.add(parent.task.id);
    current = parent;
  }

  return current.task.id !== item.task.id || parentIds.has(current.task.id)
    ? current
    : null;
}

function groupByEpic(
  tasks: DashboardTask[],
  entryById: ReadonlyMap<string, DashboardEntry>,
  parentIds: ReadonlySet<string>,
): GroupUnit[] {
  const units: GroupUnit[] = [];
  const epicUnitById = new Map<string, Extract<GroupUnit, { type: "epic" }>>();

  for (const item of tasks) {
    const root = findEpicRoot(item, entryById, parentIds);
    if (!root) {
      units.push({ type: "task", item });
      continue;
    }

    let unit = epicUnitById.get(root.task.id);
    if (!unit) {
      unit = { type: "epic", root, items: [] };
      epicUnitById.set(root.task.id, unit);
      units.push(unit);
    }
    unit.items.push(item);
  }

  return units;
}

export function buildTaskListRows(
  model: DashboardModel,
  options: BuildTaskListRowsOptions,
): TaskListRow[] {
  const entries = GROUP_ORDER.flatMap((groupId) =>
    model.groups[groupId].tasks.map((item) => ({ groupId, item })),
  );
  const entryById = new Map(
    entries.map((entry) => [entry.item.task.id, entry]),
  );
  const parentIds = new Set(
    entries
      .map(({ item }) => item.task.parent_id)
      .filter((id): id is string => id !== null && entryById.has(id)),
  );
  const rows: TaskListRow[] = [];

  for (const groupId of GROUP_ORDER) {
    const group = model.groups[groupId];
    rows.push({ key: `group:${groupId}`, type: "group", groupId });
    if (options.collapsedGroups.has(groupId)) continue;

    for (const unit of groupByEpic(group.tasks, entryById, parentIds)) {
      if (unit.type === "task") {
        rows.push({
          key: `task:${unit.item.task.id}`,
          type: "task",
          groupId,
          item: unit.item,
          epicKey: null,
          treePrefix: "",
        });
        continue;
      }

      const epicKey = `epic:${groupId}:${unit.root.task.id}`;
      const childItems = unit.items.filter(
        (item) => item.task.id !== unit.root.task.id,
      );
      rows.push({
        key: epicKey,
        type: "epic",
        groupId,
        item: unit.root,
        childCount: childItems.length,
        hasChildren: childItems.length > 0,
      });
      if (options.collapsedEpicKeys.has(epicKey)) continue;

      for (let index = 0; index < childItems.length; index++) {
        const item = childItems[index];
        rows.push({
          key: `task:${item.task.id}`,
          type: "task",
          groupId,
          item,
          epicKey,
          treePrefix: index === childItems.length - 1 ? "└─ " : "├─ ",
        });
      }
    }
  }

  return rows;
}
