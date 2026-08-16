import * as fs from "node:fs";
import * as path from "node:path";
import type { Task } from "../types.js";
import {
  readReadonlyTaskSnapshot,
  type ReadonlyTaskSnapshot,
} from "../core/readonly-snapshot.js";

export interface TaskWatchUpdate {
  tasks: Task[];
  changedAt: Date;
}

export interface TaskWatchOptions {
  debounceMs?: number;
  retryDelaysMs?: number[];
  readSnapshot?: (storagePath: string) => Promise<ReadonlyTaskSnapshot>;
  onUpdate: (update: TaskWatchUpdate) => void;
  onError: (error: Error) => void;
}

export class TaskWatchController {
  private readonly debounceMs: number;
  private readonly retryDelaysMs: number[];
  private readonly readSnapshot: (
    storagePath: string,
  ) => Promise<ReadonlyTaskSnapshot>;
  private watcher: fs.FSWatcher | null = null;
  private watchedPath: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private resolveRetryWait: (() => void) | null = null;
  private reloadInFlight = false;
  private reloadQueued = false;
  private forceQueued = false;
  private closed = false;
  private fingerprint: string | null = null;

  constructor(
    private readonly storagePath: string,
    private readonly options: TaskWatchOptions,
  ) {
    this.debounceMs = options.debounceMs ?? 50;
    this.retryDelaysMs = options.retryDelaysMs ?? [25, 75, 150];
    this.readSnapshot = options.readSnapshot ?? readReadonlyTaskSnapshot;
  }

  async start(): Promise<void> {
    if (this.watcher || this.closed) return;

    this.attachWatcher();
    await this.requestReload(true);
  }

  async refresh(): Promise<void> {
    await this.requestReload(true);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.resolveRetryWait?.();
    this.debounceTimer = null;
    this.retryTimer = null;
    this.resolveRetryWait = null;
    this.watcher?.close();
    this.watcher = null;
    this.watchedPath = null;
  }

  private attachWatcher(): void {
    if (this.closed) return;

    const storageExists = fs.existsSync(this.storagePath);
    let watchPath = this.storagePath;
    while (!fs.existsSync(watchPath)) {
      const parent = path.dirname(watchPath);
      if (parent === watchPath) break;
      watchPath = parent;
    }
    if (this.watcher && this.watchedPath === watchPath) return;

    this.watcher?.close();
    this.watchedPath = watchPath;
    this.watcher = fs.watch(watchPath, (_eventType, filename) => {
      if (this.closed) return;
      const name = filename?.toString();
      if (!storageExists) {
        const nextPathPart = path
          .relative(watchPath, this.storagePath)
          .split(path.sep)[0];
        if (name === undefined || name === nextPathPart) {
          this.attachWatcher();
          this.scheduleReload();
        }
        return;
      }
      if (
        name === undefined ||
        name === "tasks.jsonl" ||
        name === "tasks.jsonl.tmp"
      ) {
        this.scheduleReload();
      }
    });
    this.watcher.on("error", (error) => {
      if (!this.closed) this.options.onError(error);
    });
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.requestReload(false);
    }, this.debounceMs);
  }

  private async requestReload(force: boolean): Promise<void> {
    if (this.closed) return;
    if (this.reloadInFlight) {
      this.reloadQueued = true;
      this.forceQueued ||= force;
      return;
    }

    this.reloadInFlight = true;
    try {
      let nextForce = force;
      do {
        this.reloadQueued = false;
        await this.reloadWithRetry(nextForce);
        nextForce = this.forceQueued;
        this.forceQueued = false;
      } while (this.reloadQueued && !this.closed);
    } finally {
      this.reloadInFlight = false;
    }
  }

  private async reloadWithRetry(force: boolean): Promise<void> {
    let lastError: Error | null = null;
    const attempts = [0, ...this.retryDelaysMs];

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      if (this.closed) return;
      if (attempts[attempt] > 0) await this.wait(attempts[attempt]);
      if (this.closed) return;

      try {
        const snapshot = await this.readSnapshot(this.storagePath);
        if (this.closed) return;
        this.attachWatcher();
        if (!force && snapshot.fingerprint === this.fingerprint) return;
        this.fingerprint = snapshot.fingerprint;
        this.options.onUpdate({ tasks: snapshot.tasks, changedAt: new Date() });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (lastError && !this.closed) this.options.onError(lastError);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        if (this.resolveRetryWait !== finish) return;
        this.resolveRetryWait = null;
        this.retryTimer = null;
        resolve();
      };
      this.resolveRetryWait = finish;
      this.retryTimer = setTimeout(finish, ms);
    });
  }
}
