import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Task } from "../types.js";
import { TaskSchema } from "../types.js";

export class LegacyStorageError extends Error {
  constructor(storagePath: string) {
    super(
      `Legacy Dex storage found at ${path.join(storagePath, "tasks")}. Run a regular Dex command once to migrate it before opening the TUI.`,
    );
    this.name = "LegacyStorageError";
  }
}

export class ReadonlySnapshotError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReadonlySnapshotError";
  }
}

export interface ReadonlyTaskSnapshot {
  tasks: Task[];
  fingerprint: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readReadonlyTaskSnapshot(
  storagePath: string,
): Promise<ReadonlyTaskSnapshot> {
  const tasksFile = path.join(storagePath, "tasks.jsonl");

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(tasksFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ReadonlySnapshotError(`Unable to inspect ${tasksFile}`, {
        cause: error,
      });
    }
    if (await exists(path.join(storagePath, "tasks"))) {
      throw new LegacyStorageError(storagePath);
    }
    return { tasks: [], fingerprint: "missing" };
  }

  let content: string;
  try {
    content = await fs.readFile(tasksFile, "utf8");
  } catch (error) {
    throw new ReadonlySnapshotError(`Unable to read ${tasksFile}`, {
      cause: error,
    });
  }

  const tasks: Task[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;

    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch (error) {
      throw new ReadonlySnapshotError(
        `Invalid JSON in ${tasksFile} on line ${index + 1}`,
        { cause: error },
      );
    }

    const result = TaskSchema.safeParse(data);
    if (!result.success) {
      throw new ReadonlySnapshotError(
        `Invalid task in ${tasksFile} on line ${index + 1}: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
      );
    }
    tasks.push(result.data);
  }

  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return {
    tasks,
    fingerprint: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`,
  };
}
