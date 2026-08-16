import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "../types.js";
import {
  LegacyStorageError,
  ReadonlySnapshotError,
  readReadonlyTaskSnapshot,
} from "./readonly-snapshot.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dex-readonly-"));
  tempDirs.push(dir);
  return dir;
}

function task(): Task {
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
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("readReadonlyTaskSnapshot", () => {
  it("reads and validates tasks without modifying storage", async () => {
    const dir = await tempDir();
    const content = `${JSON.stringify(task())}\n`;
    await fs.writeFile(path.join(dir, "tasks.jsonl"), content);

    const snapshot = await readReadonlyTaskSnapshot(dir);

    expect(snapshot.tasks).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, "tasks.jsonl"), "utf8")).toBe(
      content,
    );
    expect(await fs.readdir(dir)).toEqual(["tasks.jsonl"]);
  });

  it("refuses legacy storage instead of migrating it", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, "tasks"));

    await expect(readReadonlyTaskSnapshot(dir)).rejects.toBeInstanceOf(
      LegacyStorageError,
    );
    expect(await fs.readdir(dir)).toEqual(["tasks"]);
  });

  it("reports malformed JSON without returning a partial snapshot", async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, "tasks.jsonl"), "{bad json}\n");

    await expect(readReadonlyTaskSnapshot(dir)).rejects.toBeInstanceOf(
      ReadonlySnapshotError,
    );
  });
});
