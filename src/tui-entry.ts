#!/usr/bin/env bun

import { runTui } from "./tui/app.js";

async function main(): Promise<void> {
  const storagePath = process.argv[2];
  if (!storagePath) throw new Error("Dex TUI storage path is required");
  await runTui(storagePath);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
