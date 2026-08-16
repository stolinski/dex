#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpServer } from "./mcp/server.js";
import { runCli } from "./cli/index.js";
import {
  parseGlobalOptions,
  createStorageEngine,
  createSyncRegistry,
  getMcpHelpText,
} from "./bootstrap.js";

function getBunExecutable(): string | null {
  const candidates = [
    process.env.BUN_INSTALL
      ? path.join(process.env.BUN_INSTALL, "bin", "bun")
      : null,
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) =>
        path.join(directory, process.platform === "win32" ? "bun.exe" : "bun"),
      ),
  ].filter((candidate): candidate is string => candidate !== null);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function reexecTuiWithBun(storagePath: string): void {
  const bunVersion = (
    process.versions as NodeJS.ProcessVersions & { bun?: string }
  ).bun;
  if (bunVersion) {
    const [major, minor] = bunVersion.split(".").map(Number);
    if (major < 1 || (major === 1 && minor < 3)) {
      throw new Error(
        `dex tui requires Bun 1.3 or newer (found ${bunVersion}).`,
      );
    }
    return;
  }

  const bun = getBunExecutable();
  if (!bun) {
    throw new Error(
      "dex tui requires Bun 1.3 or newer. Install Bun from https://bun.sh and try again.",
    );
  }

  const tuiEntry = fileURLToPath(new URL("./tui-entry.js", import.meta.url));
  const execve = (
    process as typeof process & {
      execve?: (
        file: string,
        args: string[],
        env: Record<string, string>,
      ) => never;
    }
  ).execve;
  if (!execve) {
    throw new Error(
      `This Node version cannot hand off to Bun without leaving an extra process. Run: ${bun} ${tuiEntry} ${storagePath}`,
    );
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  execve(bun, [bun, tuiEntry, storagePath], env);
}

function getTuiHelpText(): string {
  return `dex tui - Open the live read-only task dashboard

USAGE:
  dex tui

DESCRIPTION:
  Opens a narrow, single-column dashboard for the current project's Dex tasks.
  The dashboard watches tasks.jsonl and updates automatically.

KEYS:
  j/k, arrows    Move between groups and tasks
  left/right     Collapse or expand a group
  enter          Open a task or toggle a group
  escape         Return from task details
  r              Reload
  q, Ctrl+C      Quit
`;
}

async function main() {
  const args = process.argv.slice(2);
  const { storagePath, configPath, filteredArgs } = parseGlobalOptions(args);
  const command = filteredArgs[0];

  if (
    command === "tui" &&
    (filteredArgs.includes("--help") || filteredArgs.includes("-h"))
  ) {
    console.log(getTuiHelpText());
    return;
  }

  if (
    command === "mcp" &&
    (filteredArgs.includes("--help") || filteredArgs.includes("-h"))
  ) {
    console.log(getMcpHelpText());
    process.exit(0);
  }

  const storage = createStorageEngine(storagePath, configPath);
  if (command === "tui") {
    reexecTuiWithBun(storage.getIdentifier());
    const { runTui } = await import("./tui/app.js");
    await runTui(storage.getIdentifier());
    return;
  }

  const { syncRegistry, syncConfig } = await createSyncRegistry(
    storage.getIdentifier(),
    configPath,
  );

  if (command === "mcp") {
    await startMcpServer(storage, syncRegistry, syncConfig);
  } else {
    await runCli(filteredArgs, { storage, syncRegistry, syncConfig });
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
