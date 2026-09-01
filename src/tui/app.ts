import * as path from "node:path";
import stringWidth from "string-width";
import {
  BoxRenderable,
  StyledText,
  TextRenderable,
  bg,
  bold,
  brightBlack,
  cyan,
  dim,
  green,
  red,
  yellow,
  createCliRenderer,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core";
import type { Task } from "../types.js";
import {
  buildDashboardModel,
  type DashboardGroupId,
  type DashboardModel,
  type DashboardTask,
} from "../core/dashboard-model.js";
import { TaskWatchController } from "./task-watch.js";
import { buildTaskListRows, type TaskListRow } from "./task-list-model.js";

const GROUP_ORDER: DashboardGroupId[] = [
  "active",
  "ready",
  "blocked",
  "complete",
];

const COLORS = {
  background: "#0b0f14",
  text: "#d7dde5",
  selected: "#263445",
};

interface TuiState {
  model: DashboardModel;
  collapsed: Set<DashboardGroupId>;
  collapsedEpicKeys: Set<string>;
  selectedKey: string;
  detailTaskId: string | null;
  detailScroll: number;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
}

function rowsFor(state: TuiState): TaskListRow[] {
  return buildTaskListRows(state.model, {
    collapsedGroups: state.collapsed,
    collapsedEpicKeys: state.collapsedEpicKeys,
  });
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;
  if (width === 1) return "…";

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let result = "";
  for (const { segment } of segmenter.segment(value)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return result + "…";
}

function selectedChunk(text: string): TextChunk {
  return bg(COLORS.selected)(bold(text));
}

function taskStatus(groupId: DashboardGroupId): {
  symbol: string;
  style: (value: string) => TextChunk;
} {
  switch (groupId) {
    case "active":
      return { symbol: "●", style: cyan };
    case "ready":
      return { symbol: "○", style: green };
    case "blocked":
      return { symbol: "◆", style: yellow };
    case "complete":
      return { symbol: "✓", style: brightBlack };
  }
}

function taskReason(item: DashboardTask): string {
  if (item.waitingReason === "blockers") {
    const count = item.incompleteBlockerIds.length;
    return `${count} blocker${count === 1 ? "" : "s"}`;
  }
  if (item.waitingReason === "children") {
    const count = item.incompleteChildCount;
    return `${count} child${count === 1 ? "" : "ren"}`;
  }
  return "";
}

function listContent(state: TuiState, width: number): StyledText {
  const rows = rowsFor(state);
  const chunks: TextChunk[] = [];

  for (const row of rows) {
    const selected = row.key === state.selectedKey;
    if (row.type === "group") {
      const group = state.model.groups[row.groupId];
      const marker = state.collapsed.has(row.groupId) ? "▸" : "▾";
      const line = truncate(
        `${selected ? "›" : " "} ${marker} ${group.label} (${group.tasks.length})`,
        width,
      );
      chunks.push(selected ? selectedChunk(line) : bold(line));
      chunks.push({ __isChunk: true, text: "\n" });
      continue;
    }

    if (row.type === "epic") {
      const marker = row.hasChildren
        ? state.collapsedEpicKeys.has(row.key)
          ? "▸ "
          : "▾ "
        : "  ";
      const lead = `${selected ? "›" : " "}   ${marker}`;
      const symbol = "◇ ";
      const idText = row.item.task.id;
      const suffix = row.childCount ? ` (${row.childCount})` : "";
      const fixedWidth = stringWidth(lead + symbol + idText + " " + suffix);
      const name = truncate(
        row.item.task.name,
        Math.max(1, width - fixedWidth),
      );
      const line = `${lead}${symbol}${idText} ${name}${suffix}`;

      if (selected) {
        chunks.push(selectedChunk(truncate(line, width)));
      } else {
        chunks.push({ __isChunk: true, text: lead });
        chunks.push(cyan(symbol));
        chunks.push(brightBlack(idText));
        chunks.push({ __isChunk: true, text: " " });
        chunks.push(bold(name));
        if (suffix) chunks.push(dim(suffix));
      }
      chunks.push({ __isChunk: true, text: "\n" });
      continue;
    }

    const status = taskStatus(row.groupId);
    const reason = taskReason(row.item);
    const lead = row.epicKey
      ? `${selected ? "›" : " "}     ${row.treePrefix}`
      : `${selected ? "›" : " "}   `;
    const statusText = `${status.symbol} `;
    const idText = row.item.task.id;
    const priorityText = ` p${row.item.task.priority} `;
    const fixedWidth = stringWidth(lead + statusText + idText + priorityText);
    const reasonSuffix = reason ? ` · ${reason}` : "";
    const suffix =
      reasonSuffix && width - fixedWidth - stringWidth(reasonSuffix) >= 8
        ? reasonSuffix
        : "";
    const nameWidth = Math.max(1, width - fixedWidth - stringWidth(suffix));
    const name = truncate(row.item.task.name, nameWidth);
    const line = `${lead}${statusText}${idText}${priorityText}${name}${suffix}`;

    if (selected) {
      chunks.push(selectedChunk(truncate(line, width)));
    } else {
      chunks.push({ __isChunk: true, text: lead });
      chunks.push(status.style(statusText));
      chunks.push(brightBlack(idText));
      chunks.push(dim(priorityText));
      chunks.push(status.style(name));
      if (suffix) chunks.push(dim(suffix));
    }
    chunks.push({ __isChunk: true, text: "\n" });
  }

  return new StyledText(chunks);
}

function detailContent(
  task: Task,
  item: DashboardTask | undefined,
): StyledText {
  const chunks: TextChunk[] = [
    bold(task.name),
    { __isChunk: true, text: "\n" },
    dim(`${task.id} · p${task.priority}`),
    { __isChunk: true, text: "\n\n" },
  ];

  if (task.description) {
    chunks.push({ __isChunk: true, text: task.description });
    chunks.push({ __isChunk: true, text: "\n\n" });
  } else {
    chunks.push(dim("No description"));
    chunks.push({ __isChunk: true, text: "\n\n" });
  }

  if (item?.incompleteBlockerIds.length) {
    chunks.push(yellow("Blocked by"), { __isChunk: true, text: "\n" });
    for (const blockerId of item.incompleteBlockerIds) {
      chunks.push({ __isChunk: true, text: `  ${blockerId}\n` });
    }
    chunks.push({ __isChunk: true, text: "\n" });
  } else if (item?.incompleteChildCount) {
    chunks.push(
      yellow(
        `Waiting on ${item.incompleteChildCount} unfinished child task${item.incompleteChildCount === 1 ? "" : "s"}`,
      ),
      { __isChunk: true, text: "\n\n" },
    );
  }

  if (task.result) {
    chunks.push(
      green("Result"),
      { __isChunk: true, text: "\n" },
      { __isChunk: true, text: task.result },
    );
    chunks.push({ __isChunk: true, text: "\n\n" });
  }

  if (task.parent_id) {
    chunks.push(dim("Parent"), {
      __isChunk: true,
      text: `  ${task.parent_id}\n`,
    });
  }
  if (task.children.length) {
    chunks.push(dim("Children"), {
      __isChunk: true,
      text: `  ${task.children.length}\n`,
    });
  }
  if (task.started_at) {
    chunks.push(dim("Started"), {
      __isChunk: true,
      text: `   ${task.started_at}\n`,
    });
  }
  if (task.completed_at) {
    chunks.push(dim("Completed"), {
      __isChunk: true,
      text: ` ${task.completed_at}\n`,
    });
  }
  chunks.push(dim("Updated"), {
    __isChunk: true,
    text: `   ${task.updated_at}\n`,
  });

  return new StyledText(chunks);
}

function findDashboardTask(
  model: DashboardModel,
  taskId: string,
): DashboardTask | undefined {
  for (const groupId of GROUP_ORDER) {
    const item = model.groups[groupId].tasks.find(
      (candidate) => candidate.task.id === taskId,
    );
    if (item) return item;
  }
  return undefined;
}

export async function runTui(storagePath: string): Promise<void> {
  const projectName = path.basename(process.cwd());
  let watcher: TaskWatchController | null = null;
  let stopped = false;

  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    consoleMode: "disabled",
    useMouse: false,
    enableMouseMovement: false,
    exitOnCtrlC: false,
    exitSignals: [],
    backgroundColor: COLORS.background,
  });

  const container = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    paddingX: 1,
    backgroundColor: COLORS.background,
  });
  const header = new TextRenderable(renderer, {
    height: 4,
    width: "100%",
    wrapMode: "none",
    truncate: true,
    fg: COLORS.text,
  });
  const body = new TextRenderable(renderer, {
    flexGrow: 1,
    width: "100%",
    wrapMode: "none",
    truncate: true,
    fg: COLORS.text,
  });
  const footer = new TextRenderable(renderer, {
    height: 2,
    width: "100%",
    wrapMode: "none",
    truncate: true,
    fg: "#7f8b99",
  });
  container.add(header);
  container.add(body);
  container.add(footer);
  renderer.root.add(container);

  const state: TuiState = {
    model: buildDashboardModel([]),
    collapsed: new Set<DashboardGroupId>(["complete"]),
    collapsedEpicKeys: new Set<string>(),
    selectedKey: "group:active",
    detailTaskId: null,
    detailScroll: 0,
    loading: true,
    error: null,
    updatedAt: null,
  };

  function render(): void {
    const stats = state.model.stats;
    const status = state.loading
      ? yellow("… LOADING")
      : state.error
        ? red("! ERROR")
        : green("● LIVE");
    header.content = new StyledText([
      bold(cyan("DEX")),
      dim(` / ${projectName}  `),
      status,
      { __isChunk: true, text: "\n" },
      dim("READ ONLY"),
      { __isChunk: true, text: "\n" },
      cyan(`${stats.inProgress} active`),
      dim(" · "),
      green(`${stats.ready} ready`),
      dim(" · "),
      yellow(`${stats.blocked} blocked`),
      dim(" · "),
      brightBlack(`${stats.completed} done`),
      { __isChunk: true, text: "\n" },
      state.error
        ? red(truncate(state.error, Math.max(10, renderer.width - 2)))
        : dim(state.updatedAt ? "updated" : "starting"),
    ]);

    if (state.detailTaskId) {
      const item = findDashboardTask(state.model, state.detailTaskId);
      if (!item) {
        state.detailTaskId = null;
        state.detailScroll = 0;
        render();
        return;
      }
      body.wrapMode = "word";
      body.truncate = false;
      body.content = detailContent(item.task, item);
      state.detailScroll = Math.min(state.detailScroll, body.maxScrollY);
      body.scrollY = state.detailScroll;
      footer.content = "j/k scroll  esc back  r refresh  q quit";
      return;
    }

    const rows = rowsFor(state);
    if (!rows.some((row) => row.key === state.selectedKey)) {
      state.selectedKey = rows[0]?.key ?? "group:active";
    }
    body.wrapMode = "none";
    body.truncate = true;
    body.content = listContent(state, Math.max(10, renderer.width - 2));
    const selectedIndex = Math.max(
      0,
      rows.findIndex((row) => row.key === state.selectedKey),
    );
    const viewportHeight = Math.max(1, renderer.height - 6);
    body.scrollY = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(viewportHeight / 2),
        rows.length - viewportHeight,
      ),
    );
    footer.content = "j/k move  ←/→ fold  enter open\nr refresh  q quit";
  }

  function moveSelection(delta: number): void {
    const rows = rowsFor(state);
    if (!rows.length) return;
    const current = Math.max(
      0,
      rows.findIndex((row) => row.key === state.selectedKey),
    );
    const next = Math.max(0, Math.min(rows.length - 1, current + delta));
    state.selectedKey = rows[next].key;
    render();
  }

  function selectedRow(): TaskListRow | undefined {
    return rowsFor(state).find((row) => row.key === state.selectedKey);
  }

  function setRowCollapsed(collapsed: boolean): void {
    const row = selectedRow();
    if (!row) return;

    if (row.type === "group") {
      if (collapsed) state.collapsed.add(row.groupId);
      else state.collapsed.delete(row.groupId);
    } else if (row.type === "epic") {
      if (!row.hasChildren) return;
      if (collapsed) state.collapsedEpicKeys.add(row.key);
      else state.collapsedEpicKeys.delete(row.key);
    } else if (row.epicKey) {
      if (collapsed) {
        state.collapsedEpicKeys.add(row.epicKey);
        state.selectedKey = row.epicKey;
      } else {
        state.collapsedEpicKeys.delete(row.epicKey);
      }
    } else {
      if (collapsed) {
        state.collapsed.add(row.groupId);
        state.selectedKey = `group:${row.groupId}`;
      } else {
        state.collapsed.delete(row.groupId);
      }
    }
    render();
  }

  function openSelected(): void {
    const row = selectedRow();
    if (!row) return;
    if (row.type === "group") {
      if (state.collapsed.has(row.groupId)) state.collapsed.delete(row.groupId);
      else state.collapsed.add(row.groupId);
    } else {
      state.detailTaskId = row.item.task.id;
      state.detailScroll = 0;
    }
    render();
  }

  let resolveExit: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  function stop(): void {
    if (stopped) return;
    stopped = true;
    watcher?.close();
    renderer.destroy();
    resolveExit?.();
  }

  function scrollDetail(delta: number): void {
    state.detailScroll = Math.max(
      0,
      Math.min(body.maxScrollY, state.detailScroll + delta),
    );
    body.scrollY = state.detailScroll;
  }

  function onKey(key: KeyEvent): void {
    if ((key.ctrl && key.name === "c") || key.name === "q") {
      stop();
      return;
    }
    if (key.name === "r") {
      state.loading = true;
      state.error = null;
      render();
      void watcher?.refresh();
      return;
    }

    if (state.detailTaskId) {
      if (key.name === "escape" || key.name === "left") {
        state.detailTaskId = null;
        state.detailScroll = 0;
        render();
      } else if (key.name === "down" || key.name === "j") {
        scrollDetail(1);
      } else if (key.name === "up" || key.name === "k") {
        scrollDetail(-1);
      }
      return;
    }

    switch (key.name) {
      case "down":
      case "j":
        moveSelection(1);
        break;
      case "up":
      case "k":
        moveSelection(-1);
        break;
      case "left":
        setRowCollapsed(true);
        break;
      case "right":
        setRowCollapsed(false);
        break;
      case "return":
        openSelected();
        break;
    }
  }

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const exitSignals = [
    "SIGINT",
    "SIGTERM",
    "SIGQUIT",
    "SIGABRT",
    "SIGHUP",
    "SIGPIPE",
    ...(process.platform === "win32" ? ["SIGBREAK"] : []),
  ] as NodeJS.Signals[];
  for (const signal of exitSignals) {
    const handler = () => stop();
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  renderer.keyInput.on("keypress", onKey);
  renderer.on("resize", render);

  watcher = new TaskWatchController(storagePath, {
    onUpdate: ({ tasks, changedAt }) => {
      const previousTaskId = state.selectedKey.startsWith("task:")
        ? state.selectedKey.slice(5)
        : null;
      state.model = buildDashboardModel(tasks);
      state.loading = false;
      state.error = null;
      state.updatedAt = changedAt;
      if (previousTaskId && findDashboardTask(state.model, previousTaskId)) {
        state.selectedKey = `task:${previousTaskId}`;
      }
      render();
    },
    onError: (error) => {
      state.loading = false;
      state.error = error.message;
      render();
    },
  });

  try {
    render();
    await watcher.start();
    await exitPromise;
  } finally {
    watcher.close();
    renderer.keyInput.off("keypress", onKey);
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    if (!renderer.isDestroyed) renderer.destroy();
  }
}
