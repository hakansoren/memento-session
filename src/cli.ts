#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { scan } from "./commands/scan.js";
import { restore } from "./commands/restore.js";
import { watch } from "./commands/watch.js";
import { snapshot } from "./commands/snapshot.js";
import { interactive } from "./commands/interactive.js";

const program = new Command()
  .name("memento")
  .version("0.1.0")
  .description("Session recovery CLI for Claude Code & Codex CLI")
  .action(interactive); // Default: no subcommand → interactive mode

program
  .command("init")
  .description("Initialize memento and show setup instructions")
  .action(init);

program
  .command("list")
  .alias("ls")
  .description("List all tracked sessions")
  .option("--active", "Show only active sessions")
  .option("--closed", "Show only closed sessions")
  .option("--tool <tool>", "Filter by tool (claude|codex)")
  .option("--here", "Filter to current directory")
  .option("--cwd <path>", "Filter to specific directory")
  .option("--json", "Output as JSON")
  .action(list);

program
  .command("status")
  .description("Show currently active sessions")
  .action(status);

program
  .command("scan")
  .description("One-time scan of Claude/Codex session files")
  .action(scan);

program
  .command("restore")
  .description("Restore sessions in split panes")
  .option("--tool <tool>", "Filter by tool (claude|codex)")
  .option("--here", "Filter to current directory")
  .option("--cwd <path>", "Filter to specific directory")
  .option("--last", "Restore only the most recent session")
  .option("--select", "Interactive session picker")
  .option("--backend <backend>", "Terminal backend (auto|iterm2|warp|terminal|tmux)", "auto")
  .option("--layout <layout>", "tmux layout (tiled|even-horizontal|even-vertical)", "tiled")
  .argument("[sessionId]", "Restore a specific session by ID")
  .action((sessionId, opts) => {
    if (sessionId) {
      // TODO: single session restore by ID
    }
    return restore(opts);
  });

// Shortcuts: memento claude / memento codex
program
  .command("claude")
  .description("Restore Claude sessions from current directory")
  .option("--all", "Restore from all directories")
  .option("--last", "Restore only the most recent session")
  .option("--select", "Interactive session picker")
  .option("--layout <layout>", "tmux layout", "tiled")
  .action((opts) => {
    return restore({
      tool: "claude",
      here: !opts.all,
      last: opts.last,
      select: opts.select,
      layout: opts.layout,
    });
  });

program
  .command("codex")
  .description("Restore Codex sessions from current directory")
  .option("--all", "Restore from all directories")
  .option("--last", "Restore only the most recent session")
  .option("--select", "Interactive session picker")
  .option("--layout <layout>", "tmux layout", "tiled")
  .action((opts) => {
    return restore({
      tool: "codex",
      here: !opts.all,
      last: opts.last,
      select: opts.select,
      layout: opts.layout,
    });
  });

program
  .command("watch")
  .description("Scan for sessions periodically")
  .option("--interval <seconds>", "Scan interval in seconds", "30")
  .action(watch);

program
  .command("snapshot")
  .description("Save a point-in-time snapshot of active sessions")
  .action(snapshot);

program.parse();
