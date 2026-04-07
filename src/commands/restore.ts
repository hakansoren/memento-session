import { execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { tmpdir } from "os";
import { createInterface } from "readline";
import chalk from "chalk";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
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
  backend?: "auto" | "tmux" | "iterm2" | "warp" | "terminal";
  yolo?: boolean;
}

// ─── Terminal detection ───

type TerminalBackend = "iterm2" | "warp" | "terminal" | "powershell" | "tmux";

function detectTerminal(): TerminalBackend {
  const termProgram = process.env.TERM_PROGRAM || "";
  if (termProgram.includes("iTerm")) return "iterm2";
  if (termProgram.includes("Warp")) return "warp";
  if (termProgram === "Apple_Terminal") return "terminal";
  if (process.platform === "win32") return "powershell";
  return "tmux";
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

// ─── Shared helpers ───

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

function buildFullCmd(session: Session): string {
  return `cd '${session.cwd}' && ${buildResumeCmd(session)}`;
}

function runAppleScript(script: string): void {
  const tmpFile = join(tmpdir(), `memento-${process.pid}-${Date.now()}.scpt`);
  writeFileSync(tmpFile, script);
  try {
    execSync(`osascript ${tmpFile}`, { stdio: "ignore", timeout: 30000 });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function sleep(seconds: number): void {
  spawnSync("sleep", [String(seconds)]);
}

// ─── iTerm2 ───

function restoreWithITerm2(sessions: Session[]): void {
  const lines: string[] = [];
  lines.push(`tell application "iTerm2"`);
  lines.push(`  tell current window`);

  sessions.forEach((session, i) => {
    const cmd = buildFullCmd(session);

    if (i === 0) {
      lines.push(`    tell current session`);
      lines.push(`      write text ${JSON.stringify(cmd)}`);
      lines.push(`    end tell`);
    } else {
      const direction = i % 2 === 1 ? "vertically" : "horizontally";
      lines.push(`    tell current session`);
      lines.push(`      set newSession to (split ${direction} with default profile)`);
      lines.push(`    end tell`);
      lines.push(`    tell newSession`);
      lines.push(`      write text ${JSON.stringify(cmd)}`);
      lines.push(`    end tell`);
    }
  });

  lines.push(`  end tell`);
  lines.push(`end tell`);

  runAppleScript(lines.join("\n"));
}

// ─── Warp ───

function restoreWithWarp(sessions: Session[]): void {
  for (let i = 0; i < sessions.length; i++) {
    const cmd = buildFullCmd(sessions[i]);

    if (i === 0) {
      runAppleScript(`tell application "Warp" to activate`);
      sleep(0.5);
    } else {
      // Split pane: alternate Cmd+D (vertical) / Cmd+Shift+D (horizontal)
      const splitKey = i % 2 === 1
        ? `key code 2 using {command down}`
        : `key code 2 using {command down, shift down}`;
      runAppleScript(
        `tell application "System Events" to tell process "Warp" to ${splitKey}`
      );
      sleep(1);
    }

    // Paste via clipboard to avoid all escaping issues
    runAppleScript([
      `set oldClip to the clipboard`,
      `set the clipboard to ${JSON.stringify(cmd)}`,
      `tell application "System Events"`,
      `  keystroke "v" using {command down}`,
      `  delay 0.3`,
      `  key code 36`,
      `end tell`,
      `delay 0.5`,
      `set the clipboard to oldClip`,
    ].join("\n"));

    sleep(0.5);
  }
}

// ─── Terminal.app ───

function restoreWithTerminalApp(sessions: Session[]): void {
  sessions.forEach((session, i) => {
    const cmd = buildFullCmd(session);

    if (i === 0) {
      runAppleScript([
        `tell application "Terminal"`,
        `  activate`,
        `  do script ${JSON.stringify(cmd)} in front window`,
        `end tell`,
      ].join("\n"));
    } else {
      runAppleScript([
        `tell application "Terminal"`,
        `  do script ${JSON.stringify(cmd)}`,
        `end tell`,
      ].join("\n"));
    }
  });
}

// ─── PowerShell / Windows Terminal ───

function restoreWithPowerShell(sessions: Session[]): void {
  const hasWt = (() => {
    try {
      execSync("where wt", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (hasWt) {
    const args: string[] = [];
    sessions.forEach((session, i) => {
      const cmd = buildResumeCmd(session);
      if (i === 0) {
        args.push("new-tab", "--title", session.sessionName || "memento", "-d", session.cwd, "pwsh", "-NoExit", "-Command", cmd);
      } else {
        const dir = i % 2 === 1 ? "-V" : "-H";
        args.push(";", "split-pane", dir, "--title", session.sessionName || "memento", "-d", session.cwd, "pwsh", "-NoExit", "-Command", cmd);
      }
    });
    spawnSync("wt", args, { stdio: "inherit" });
  } else {
    for (const session of sessions) {
      const cmd = buildResumeCmd(session);
      spawnSync("powershell", [
        "-Command",
        `Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'cd "${session.cwd}"; ${cmd}'`,
      ]);
    }
  }
}

// ─── tmux ───

function restoreWithTmux(sessions: Session[], layout: string): void {
  const tmuxSession = `memento-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
  const inTmux = !!process.env.TMUX;

  let paneCount = 0;
  for (const session of sessions) {
    const cmd = buildResumeCmd(session);
    const windowName = session.sessionName || session.cwd.split("/").pop() || "session";

    if (paneCount === 0) {
      spawnSync("tmux", ["new-session", "-d", "-s", tmuxSession, "-n", windowName, "-c", session.cwd]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, cmd, "Enter"]);
    } else {
      spawnSync("tmux", ["split-window", "-t", tmuxSession, "-c", session.cwd]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, cmd, "Enter"]);
      spawnSync("tmux", ["select-layout", "-t", tmuxSession, layout], { stdio: "ignore" });
    }
    paneCount++;
  }

  spawnSync("tmux", ["select-layout", "-t", tmuxSession, layout], { stdio: "ignore" });

  console.log();
  console.log(`${chalk.green("✓")} tmux session: ${chalk.bold(tmuxSession)}`);

  if (inTmux) {
    spawnSync("tmux", ["switch-client", "-t", tmuxSession], { stdio: "inherit" });
  } else {
    spawnSync("tmux", ["attach-session", "-t", tmuxSession], { stdio: "inherit" });
  }
}

// ─── Main restore ───

export async function restore(opts: RestoreOptions): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

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

  let backend: TerminalBackend;
  if (opts.backend && opts.backend !== "auto") {
    backend = opts.backend as TerminalBackend;
  } else {
    backend = detectTerminal();
  }

  if (backend === "tmux" && !hasTmux()) {
    console.error(`${chalk.red("Error:")} No supported terminal detected and tmux is not installed.`);
    console.error(`  Install tmux: ${chalk.bold("brew install tmux")}`);
    console.error(`  Or use a supported terminal: iTerm2, Warp, Terminal.app`);
    process.exit(1);
  }

  _yolo = !!opts.yolo;

  const yoloLabel = _yolo ? chalk.red(" [YOLO]") : "";
  console.log(chalk.bold(`Restoring ${toRestore.length} session(s) via ${backend}...`) + yoloLabel);
  console.log();

  for (const session of toRestore) {
    const display = (session.sessionName || session.sessionId || "").slice(0, 40);
    console.log(`  ${chalk.green("✓")} [${session.tool}] ${display} — ${shortPath(session.cwd)}`);
  }

  switch (backend) {
    case "iterm2":    restoreWithITerm2(toRestore); break;
    case "warp":      restoreWithWarp(toRestore); break;
    case "terminal":  restoreWithTerminalApp(toRestore); break;
    case "powershell": restoreWithPowerShell(toRestore); break;
    case "tmux":      restoreWithTmux(toRestore, opts.layout || "tiled"); break;
  }

  console.log();
  console.log(`${chalk.green("✓")} Restored ${toRestore.length} session(s)`);
}
