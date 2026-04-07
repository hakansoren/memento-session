import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
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
  yolo?: boolean; // skip all permissions
}

// ─── Terminal detection ───

type TerminalBackend = "iterm2" | "warp" | "terminal" | "powershell" | "tmux";

function detectTerminal(): TerminalBackend {
  const termProgram = process.env.TERM_PROGRAM || "";
  const isWindows = process.platform === "win32";

  if (termProgram.includes("iTerm")) return "iterm2";
  if (termProgram.includes("Warp")) return "warp";
  if (termProgram === "Apple_Terminal") return "terminal";
  if (isWindows) return "powershell";
  return "tmux"; // fallback for Linux / unknown
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

// Whether --yolo mode is active (set before calling backends)
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

// ─── AppleScript backends ───

function restoreWithITerm2(sessions: Session[]): void {
  // First session: use current tab. Rest: split panes.
  const commands: string[] = [];
  commands.push(`tell application "iTerm2"`);
  commands.push(`  tell current window`);

  sessions.forEach((session, i) => {
    const resumeCmd = buildResumeCmd(session);

    if (i === 0) {
      // Use the current session/tab
      commands.push(`    tell current session`);
      commands.push(`      write text "cd '${session.cwd}' && ${resumeCmd}"`);
      commands.push(`    end tell`);
    } else {
      // Split pane: alternate vertical/horizontal for grid
      const direction = i % 2 === 1 ? "vertically" : "horizontally";
      commands.push(`    tell current session`);
      commands.push(`      set newSession to (split ${direction} with default profile)`);
      commands.push(`    end tell`);
      commands.push(`    tell newSession`);
      commands.push(`      write text "cd '${session.cwd}' && ${resumeCmd}"`);
      commands.push(`    end tell`);
    }
  });

  commands.push(`  end tell`);
  commands.push(`end tell`);

  execSync(`osascript -e '${commands.join("\n").replace(/'/g, "'\\''")}'`, {
    stdio: "ignore",
  });
}

function restoreWithWarp(sessions: Session[]): void {
  // Warp: use AppleScript with System Events for split panes
  // Cmd+D = vertical split, Cmd+Shift+D = horizontal split
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const resumeCmd = buildResumeCmd(session);
    const fullCmd = `cd '${session.cwd}' && ${resumeCmd}`;

    if (i > 0) {
      // Split pane: alternate vertical/horizontal
      const splitScript = i % 2 === 1
        ? `tell application "System Events" to tell process "Warp" to key code 2 using {command down}`
        : `tell application "System Events" to tell process "Warp" to key code 2 using {command down, shift down}`;
      execSync(`osascript -e '${splitScript}'`, { stdio: "ignore" });
      execSync("sleep 0.8");
    } else {
      execSync(`osascript -e 'tell application "Warp" to activate'`, { stdio: "ignore" });
      execSync("sleep 0.5");
    }

    // Type command via System Events keystroke (more reliable with escaping)
    const escaped = fullCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const typeScript = [
      `tell application "System Events"`,
      `  tell process "Warp"`,
      `    keystroke "${escaped}"`,
      `    key code 36`,
      `  end tell`,
      `end tell`,
    ].join("\n");
    execSync(`osascript -e '${typeScript.replace(/'/g, "'\\''")}'`, { stdio: "ignore" });
    execSync("sleep 0.3");
  }
}

function restoreWithTerminalApp(sessions: Session[]): void {
  // Terminal.app: open new tabs (no split pane support)
  sessions.forEach((session, i) => {
    const resumeCmd = buildResumeCmd(session);
    const fullCmd = `cd '${session.cwd}' && ${resumeCmd}`;

    if (i === 0) {
      execSync(
        `osascript -e 'tell application "Terminal" to do script "${fullCmd.replace(/"/g, '\\"')}" in front window'`,
        { stdio: "ignore" }
      );
    } else {
      execSync(
        `osascript -e 'tell application "Terminal" to do script "${fullCmd.replace(/"/g, '\\"')}"'`,
        { stdio: "ignore" }
      );
    }
  });
}

function restoreWithPowerShell(sessions: Session[]): void {
  // Windows Terminal: open new tabs via `wt` CLI
  // Each session gets its own tab (WT doesn't support split via CLI well)
  const hasWt = (() => {
    try {
      execSync("where wt", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (hasWt) {
    // Use Windows Terminal CLI for split panes
    const args: string[] = [];
    sessions.forEach((session, i) => {
      const resumeCmd = session.tool === "claude"
        ? `claude --resume '${session.sessionId}'`
        : `codex resume '${session.sessionId}'`;
      const fullCmd = `cd '${session.cwd}'; ${resumeCmd}`;

      if (i === 0) {
        args.push("new-tab", "--title", session.sessionName || "memento", "-d", session.cwd, "pwsh", "-NoExit", "-Command", resumeCmd);
      } else {
        // Alternate split direction
        const split = i % 2 === 1 ? "split-pane" : "split-pane";
        const dir = i % 2 === 1 ? "-V" : "-H";
        args.push(";", split, dir, "--title", session.sessionName || "memento", "-d", session.cwd, "pwsh", "-NoExit", "-Command", resumeCmd);
      }
    });

    spawnSync("wt", args, { stdio: "inherit" });
  } else {
    // Fallback: open separate PowerShell windows
    for (const session of sessions) {
      const resumeCmd = session.tool === "claude"
        ? `claude --resume '${session.sessionId}'`
        : `codex resume '${session.sessionId}'`;
      spawnSync("powershell", [
        "-Command",
        `Start-Process pwsh -ArgumentList '-NoExit', '-Command', 'cd "${session.cwd}"; ${resumeCmd}'`,
      ]);
    }
  }
}

function restoreWithTmux(sessions: Session[], layout: string): void {
  const tmuxSession = `memento-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
  const inTmux = !!process.env.TMUX;

  let paneCount = 0;
  for (const session of sessions) {
    const resumeCmd = buildResumeCmd(session);
    const windowName = session.sessionName || session.cwd.split("/").pop() || "session";

    if (paneCount === 0) {
      spawnSync("tmux", ["new-session", "-d", "-s", tmuxSession, "-n", windowName, "-c", session.cwd]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, resumeCmd, "Enter"]);
    } else {
      spawnSync("tmux", ["split-window", "-t", tmuxSession, "-c", session.cwd]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, resumeCmd, "Enter"]);
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

  // Detect backend
  let backend: TerminalBackend;
  if (opts.backend && opts.backend !== "auto") {
    backend = opts.backend as TerminalBackend;
  } else {
    backend = detectTerminal();
  }

  // Fallback to tmux if native terminal and tmux needed
  if (backend === "tmux" && !hasTmux()) {
    console.error(
      `${chalk.red("Error:")} No supported terminal detected and tmux is not installed.`
    );
    console.error(`  Install tmux: ${chalk.bold("brew install tmux")}`);
    console.error(`  Or use a supported terminal: iTerm2, Warp, Terminal.app`);
    process.exit(1);
  }

  // Set yolo mode for resume command builder
  _yolo = !!opts.yolo;

  const yoloLabel = _yolo ? chalk.red(" [YOLO]") : "";
  console.log(chalk.bold(`Restoring ${toRestore.length} session(s) via ${backend}...`) + yoloLabel);
  console.log();

  for (const session of toRestore) {
    const display = (session.sessionName || session.sessionId || "").slice(0, 40);
    console.log(`  ${chalk.green("✓")} [${session.tool}] ${display} — ${shortPath(session.cwd)}`);
  }

  const layout = opts.layout || "tiled";

  switch (backend) {
    case "iterm2":
      restoreWithITerm2(toRestore);
      break;
    case "warp":
      restoreWithWarp(toRestore);
      break;
    case "terminal":
      restoreWithTerminalApp(toRestore);
      break;
    case "powershell":
      restoreWithPowerShell(toRestore);
      break;
    case "tmux":
      restoreWithTmux(toRestore, layout);
      break;
  }

  console.log();
  console.log(`${chalk.green("✓")} Restored ${toRestore.length} session(s)`);
}
