import { execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { tmpdir } from "os";
import { createInterface } from "readline";
import chalk from "chalk";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import { scanClaudeSessions, scanCodexSessions } from "../scanners/index.js";
import type { Session, SessionFilter } from "../types.js";

export interface RestoreOptions {
  tool?: string;
  here?: boolean;
  cwd?: string;
  last?: boolean;
  select?: boolean;
  layout?: string;
  all?: boolean;
  status?: "active" | "closed" | "all";
  yolo?: boolean;
}

function hasTmux(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function shortPath(p: string): string {
  return p.replace(homedir(), "~");
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getResumableSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.sessionId && existsSync(s.cwd));
}

let _yolo = false;

function buildResumeCmd(session: Session): string {
  if (session.tool === "claude") {
    const flags = _yolo ? " --dangerously-skip-permissions" : "";
    return `claude --resume '${session.sessionId}'${flags}`;
  } else {
    const flags = _yolo ? " --full-auto" : "";
    return `codex resume '${session.sessionId}'${flags}`;
  }
}

// ─── Restore via tmux (works in ANY terminal) ───

function restoreWithTmux(sessions: Session[], layout: string): void {
  const tmuxSession = `memento-${Date.now().toString(36)}`;

  // Generate a shell script that sets up the entire tmux session
  // This avoids all AppleScript/permission issues
  const scriptLines: string[] = [
    "#!/usr/bin/env bash",
    "",
    "# Kill existing memento tmux sessions if any",
    `tmux kill-session -t "${tmuxSession}" 2>/dev/null || true`,
    "",
    "# Enable mouse support so you can click between panes",
    `tmux set-option -g mouse on 2>/dev/null || true`,
    "",
  ];

  sessions.forEach((session, i) => {
    const cmd = buildResumeCmd(session);
    const windowName = session.sessionName || session.cwd.split("/").pop() || "session";

    if (i === 0) {
      scriptLines.push(`# First pane`);
      scriptLines.push(`tmux new-session -d -s "${tmuxSession}" -n "${windowName}" -c "${session.cwd}"`);
      scriptLines.push(`tmux send-keys -t "${tmuxSession}" "${cmd}" Enter`);
    } else {
      scriptLines.push(`# Pane ${i + 1}`);
      scriptLines.push(`tmux split-window -t "${tmuxSession}" -c "${session.cwd}"`);
      scriptLines.push(`tmux send-keys -t "${tmuxSession}" "${cmd}" Enter`);
      scriptLines.push(`tmux select-layout -t "${tmuxSession}" "${layout}" 2>/dev/null || true`);
    }
    scriptLines.push("");
  });

  // Final layout + mouse mode + attach
  scriptLines.push(`# Final layout`);
  scriptLines.push(`tmux select-layout -t "${tmuxSession}" "${layout}" 2>/dev/null || true`);
  scriptLines.push("");
  scriptLines.push(`# Enable mouse mode for this session`);
  scriptLines.push(`tmux set-option -t "${tmuxSession}" mouse on`);
  scriptLines.push("");
  scriptLines.push(`# Set pane border format for easier identification`);
  scriptLines.push(`tmux set-option -t "${tmuxSession}" pane-border-status top`);
  scriptLines.push(`tmux set-option -t "${tmuxSession}" pane-border-format " #{pane_index}: #{pane_current_command} — #{pane_current_path} "`);
  scriptLines.push("");
  scriptLines.push(`# Attach`);
  scriptLines.push(`if [ -n "$TMUX" ]; then`);
  scriptLines.push(`  tmux switch-client -t "${tmuxSession}"`);
  scriptLines.push(`else`);
  scriptLines.push(`  tmux attach-session -t "${tmuxSession}"`);
  scriptLines.push(`fi`);

  const scriptPath = join(tmpdir(), `memento-restore-${process.pid}.sh`);
  writeFileSync(scriptPath, scriptLines.join("\n"), { mode: 0o755 });

  console.log();
  console.log(`${chalk.green("✓")} tmux session: ${chalk.bold(tmuxSession)}`);
  console.log();
  console.log(chalk.dim("  Mouse enabled — click panes to switch"));
  console.log(chalk.dim("  Detach: Ctrl+B then D"));
  console.log(chalk.dim("  Reattach: tmux attach"));
  console.log();

  // Execute the script — this will attach to tmux
  try {
    spawnSync("bash", [scriptPath], { stdio: "inherit" });
  } finally {
    try { unlinkSync(scriptPath); } catch {}
  }
}

// ─── Main restore ───

export async function restore(opts: RestoreOptions): Promise<void> {
  await ensureDirs();
  await scanClaudeSessions();
  await scanCodexSessions();
  await cleanupStaleSessions();

  if (!hasTmux()) {
    console.error(`${chalk.red("Error:")} tmux is required. Install with: ${chalk.bold("brew install tmux")}`);
    process.exit(1);
  }

  const filter: SessionFilter = { status: opts.status || "closed" };
  if (opts.tool) filter.tool = opts.tool as "claude" | "codex";
  if (opts.here) filter.cwd = process.cwd();
  else if (opts.cwd) filter.cwd = opts.cwd;

  let sessions = await getAllSessions(filter);
  sessions = getResumableSessions(sessions);

  if (sessions.length === 0) {
    let hint = "";
    if (filter.cwd) hint += ` in ${shortPath(filter.cwd)}`;
    if (filter.tool && filter.tool !== "all") hint += ` for ${filter.tool}`;
    console.log(chalk.dim(`No restorable sessions found${hint}.`));
    return;
  }

  let toRestore: Session[];

  if (opts.last) {
    toRestore = [sessions[0]];
  } else if (opts.select) {
    console.log(chalk.bold("Restorable sessions:"));
    if (filter.tool && filter.tool !== "all") {
      console.log(chalk.dim(`  (filtered: tool=${filter.tool})`));
    }
    if (filter.cwd) {
      console.log(chalk.dim(`  (filtered: dir=${shortPath(filter.cwd)})`));
    }
    console.log();

    sessions.forEach((s, i) => {
      const name = s.sessionName || "-";
      const started = s.startedAt.slice(0, 16).replace("T", " ");
      console.log(
        `  ${chalk.bold(`${i + 1})`)} [${s.tool}] ${name} — ${shortPath(s.cwd)} — ${started}`
      );
    });

    console.log();
    const selection = await prompt("Enter session numbers (comma-separated, or 'all'): ");

    if (selection === "all") {
      toRestore = sessions;
    } else {
      const nums = selection.split(",").map((n) => parseInt(n.trim()) - 1);
      toRestore = nums
        .filter((i) => i >= 0 && i < sessions.length)
        .map((i) => sessions[i]);
    }
  } else {
    toRestore = sessions;
  }

  if (toRestore.length === 0) {
    console.log(chalk.dim("No sessions selected."));
    return;
  }

  _yolo = !!opts.yolo;

  const yoloLabel = _yolo ? chalk.red(" [YOLO]") : "";
  console.log(chalk.bold(`Restoring ${toRestore.length} session(s)...`) + yoloLabel);
  console.log();

  for (const session of toRestore) {
    const display = (session.sessionName || session.sessionId || "").slice(0, 40);
    console.log(`  ${chalk.green("✓")} [${session.tool}] ${display} — ${shortPath(session.cwd)}`);
  }

  restoreWithTmux(toRestore, opts.layout || "tiled");
}
