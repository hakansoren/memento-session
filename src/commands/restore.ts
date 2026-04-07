import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { createInterface } from "readline";
import chalk from "chalk";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import type { Session, SessionFilter } from "../types.js";

interface RestoreOptions {
  tool?: string;
  here?: boolean;
  cwd?: string;
  last?: boolean;
  select?: boolean;
  layout?: string;
  all?: boolean;
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

function getResumableSessiones(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.sessionId && existsSync(s.cwd));
}

export async function restore(opts: RestoreOptions): Promise<void> {
  await ensureDirs();

  if (!hasTmux()) {
    console.error(
      `${chalk.red("Error:")} tmux is required. Install with: ${chalk.bold("brew install tmux")}`
    );
    process.exit(1);
  }

  await cleanupStaleSessions();

  const filter: SessionFilter = { status: "closed" };
  if (opts.tool) filter.tool = opts.tool as "claude" | "codex";
  if (opts.here) filter.cwd = process.cwd();
  else if (opts.cwd) filter.cwd = opts.cwd;

  let sessions = await getAllSessions(filter);
  sessions = getResumableSessiones(sessions);

  if (sessions.length === 0) {
    let hint = "";
    if (filter.cwd) hint += ` in ${shortPath(filter.cwd)}`;
    if (filter.tool && filter.tool !== "all") hint += ` for ${filter.tool}`;
    console.log(chalk.dim(`No restorable sessions found${hint}.`));
    return;
  }

  let toRestore: Session[];

  if (opts.last) {
    toRestore = [sessions[0]]; // already sorted by startedAt desc
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
    const selection = await prompt(
      "Enter session numbers (comma-separated, or 'all'): "
    );

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

  const layout = opts.layout || "tiled";
  const tmuxSession = `memento-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
  const inTmux = !!process.env.TMUX;

  console.log(chalk.bold(`Restoring ${toRestore.length} session(s)...`));
  console.log();

  let paneCount = 0;

  for (const session of toRestore) {
    const resumeCmd =
      session.tool === "claude"
        ? `claude --resume '${session.sessionId}'`
        : `codex resume '${session.sessionId}'`;

    const windowName = session.sessionName || session.cwd.split("/").pop() || "session";

    if (paneCount === 0) {
      spawnSync("tmux", [
        "new-session", "-d", "-s", tmuxSession, "-n", windowName, "-c", session.cwd,
      ]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, resumeCmd, "Enter"]);
    } else {
      spawnSync("tmux", [
        "split-window", "-t", tmuxSession, "-c", session.cwd,
      ]);
      spawnSync("tmux", ["send-keys", "-t", tmuxSession, resumeCmd, "Enter"]);
      spawnSync("tmux", ["select-layout", "-t", tmuxSession, layout], {
        stdio: "ignore",
      });
    }

    paneCount++;
    const display = (session.sessionName || session.sessionId || "").slice(0, 40);
    console.log(
      `  ${chalk.green("✓")} [${session.tool}] ${display} — ${shortPath(session.cwd)}`
    );
  }

  if (paneCount === 0) {
    console.log(chalk.red("No sessions were restored."));
    process.exit(1);
  }

  // Final layout
  spawnSync("tmux", ["select-layout", "-t", tmuxSession, layout], {
    stdio: "ignore",
  });

  console.log();
  console.log(
    `${chalk.green("✓")} Restored ${paneCount} session(s) in tmux session: ${chalk.bold(tmuxSession)}`
  );

  // Attach
  if (inTmux) {
    spawnSync("tmux", ["switch-client", "-t", tmuxSession], {
      stdio: "inherit",
    });
  } else {
    spawnSync("tmux", ["attach-session", "-t", tmuxSession], {
      stdio: "inherit",
    });
  }
}
