import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "../types.js";
import { TaskWatchController } from "./task-watch.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dex-watch-"));
  tempDirs.push(dir);
  return dir;
}

function task(id: string, name = id): Task {
  return {
    id,
    parent_id: null,
    name,
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
  };
}

async function atomicWrite(dir: string, tasks: Task[]): Promise<void> {
  const temp = path.join(dir, "tasks.jsonl.tmp");
  const target = path.join(dir, "tasks.jsonl");
  await fs.writeFile(
    temp,
    tasks.map((item) => JSON.stringify(item)).join("\n") + "\n",
  );
  await fs.rename(temp, target);
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for watcher");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("TaskWatchController", () => {
  it("follows atomic file replacements by watching the directory", async () => {
    const dir = await createTempDir();
    await atomicWrite(dir, [task("first")]);
    const updates: string[][] = [];
    const watcher = new TaskWatchController(dir, {
      debounceMs: 10,
      retryDelaysMs: [5, 10],
      onUpdate: ({ tasks }) => updates.push(tasks.map((item) => item.id)),
      onError: (error) => {
        throw error;
      },
    });

    try {
      await watcher.start();
      await atomicWrite(dir, [task("first"), task("second")]);
      await waitFor(() => updates.length === 2);

      expect(updates).toEqual([["first"], ["first", "second"]]);
    } finally {
      watcher.close();
    }
  });

  it("keeps the last good snapshot through a transient invalid write", async () => {
    const dir = await createTempDir();
    await atomicWrite(dir, [task("first")]);
    const updates: string[][] = [];
    const errors: Error[] = [];
    const watcher = new TaskWatchController(dir, {
      debounceMs: 10,
      retryDelaysMs: [5, 10],
      onUpdate: ({ tasks }) => updates.push(tasks.map((item) => item.id)),
      onError: (error) => errors.push(error),
    });

    try {
      await watcher.start();
      await fs.writeFile(path.join(dir, "tasks.jsonl"), "{invalid}\n");
      await waitFor(() => errors.length === 1);
      expect(updates).toEqual([["first"]]);

      await atomicWrite(dir, [task("recovered")]);
      await waitFor(() => updates.length === 2);
      expect(updates[1]).toEqual(["recovered"]);
    } finally {
      watcher.close();
    }
  });

  it("starts read-only before the storage directory exists and attaches when created", async () => {
    const root = await createTempDir();
    const storagePath = path.join(root, ".dex");
    const updates: string[][] = [];
    const watcher = new TaskWatchController(storagePath, {
      debounceMs: 10,
      retryDelaysMs: [5, 10],
      onUpdate: ({ tasks }) => updates.push(tasks.map((item) => item.id)),
      onError: (error) => {
        throw error;
      },
    });

    try {
      await watcher.start();
      expect(updates).toEqual([[]]);

      await fs.mkdir(storagePath);
      await atomicWrite(storagePath, [task("created")]);
      await waitFor(() => updates.length === 2);
      expect(updates[1]).toEqual(["created"]);
    } finally {
      watcher.close();
    }
  });

  it("does not publish an in-flight snapshot after close", async () => {
    const dir = await createTempDir();
    let finishRead:
      | ((snapshot: { tasks: Task[]; fingerprint: string }) => void)
      | null = null;
    const updates: string[][] = [];
    const watcher = new TaskWatchController(dir, {
      readSnapshot: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
      onUpdate: ({ tasks }) => updates.push(tasks.map((item) => item.id)),
      onError: (error) => {
        throw error;
      },
    });

    const starting = watcher.start();
    await waitFor(() => finishRead !== null);
    watcher.close();
    finishRead!({ tasks: [task("late")], fingerprint: "late" });
    await starting;

    expect(updates).toEqual([]);
  });

  it("settles a retry delay when closed", async () => {
    const dir = await createTempDir();
    const watcher = new TaskWatchController(dir, {
      retryDelaysMs: [10_000],
      readSnapshot: async () => {
        throw new Error("retry");
      },
      onUpdate: () => {},
      onError: () => {},
    });

    const starting = watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    watcher.close();
    await expect(starting).resolves.toBeUndefined();
  });

  it("coalesces a burst and never runs snapshot reads concurrently", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "tasks.jsonl"), "");
    let reads = 0;
    let activeReads = 0;
    let maxActiveReads = 0;
    const watcher = new TaskWatchController(dir, {
      debounceMs: 20,
      retryDelaysMs: [],
      readSnapshot: async () => {
        reads++;
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeReads--;
        return { tasks: [], fingerprint: String(reads) };
      },
      onUpdate: () => {},
      onError: (error) => {
        throw error;
      },
    });

    try {
      await watcher.start();
      for (let index = 0; index < 8; index++) {
        await fs.writeFile(path.join(dir, "tasks.jsonl.tmp"), String(index));
      }
      await waitFor(() => reads >= 2);
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(maxActiveReads).toBe(1);
      expect(reads).toBeLessThanOrEqual(3);
    } finally {
      watcher.close();
    }
  });
});
