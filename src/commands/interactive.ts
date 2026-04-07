import { createInterface } from "readline";
import chalk from "chalk";
import { homedir } from "os";
import { basename } from "path";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import { restore } from "./restore.js";
import type { Session } from "../types.js";

function shortPath(p: string): string {
  return p.replace(homedir(), "~");
}

function groupByDirectory(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const existing = groups.get(s.cwd) || [];
    existing.push(s);
    groups.set(s.cwd, existing);
  }
  return groups;
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

export async function interactive(): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

  const sessions = await getAllSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim("No sessions found. Run 'memento scan' first."));
    return;
  }

  const groups = groupByDirectory(sessions);
  const dirs = [...groups.keys()].sort();

  const active = sessions.filter((s) => s.status === "active").length;
  const closed = sessions.filter((s) => s.status === "closed").length;

  const logo = `
  ${chalk.bold.cyan("███╗   ███╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗ ██████╗ ")}
  ${chalk.bold.cyan("████╗ ████║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗")}
  ${chalk.bold.cyan("██╔████╔██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║")}
  ${chalk.bold.cyan("██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║")}
  ${chalk.bold.cyan("██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ╚██████╔╝")}
  ${chalk.bold.cyan("╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ")}

  ${chalk.white("Session recovery for Claude Code & Codex CLI")}
  ${chalk.dim(`${sessions.length} sessions across ${dirs.length} projects`)} ${chalk.dim("—")} ${chalk.green(`${active} active`)}${closed > 0 ? chalk.dim(", ") + chalk.yellow(`${closed} closed`) : ""}`;

  console.log(logo);
  console.log();

  let idx = 1;
  const dirIndex: { num: number; cwd: string; sessions: Session[] }[] = [];

  for (const dir of dirs) {
    const dirSessions = groups.get(dir)!;
    const activeCount = dirSessions.filter((s) => s.status === "active").length;
    const closedCount = dirSessions.filter((s) => s.status === "closed").length;
    const dirName = basename(dir);

    const statusParts: string[] = [];
    if (activeCount > 0) statusParts.push(chalk.green(`${activeCount} active`));
    if (closedCount > 0) statusParts.push(chalk.yellow(`${closedCount} closed`));

    console.log(
      `  ${chalk.bold.cyan(`${idx})`)} ${chalk.bold(dirName)} ${chalk.dim(`(${shortPath(dir)})`)} — ${statusParts.join(", ")}`
    );

    // Show sessions under each directory
    for (const s of dirSessions) {
      const name = s.sessionName || s.sessionId?.slice(0, 8) || "?";
      const statusIcon = s.status === "active" ? chalk.green("●") : chalk.yellow("○");
      const started = s.startedAt.slice(0, 16).replace("T", " ");
      console.log(
        `     ${statusIcon} ${chalk.dim(`[${s.tool}]`)} ${name} ${chalk.dim(`— ${started}`)}`
      );
    }

    dirIndex.push({ num: idx, cwd: dir, sessions: dirSessions });
    idx++;
    console.log();
  }

  console.log(chalk.dim("  Commands:"));
  console.log(chalk.dim("    <number>     Open all sessions from that directory"));
  console.log(chalk.dim("    <number>c    Open only closed sessions (restorable)"));
  console.log(chalk.dim("    q            Quit"));
  console.log();

  const answer = await prompt(chalk.bold("  Select: "));

  if (answer === "q" || answer === "") return;

  const closedOnly = answer.endsWith("c");
  const num = parseInt(answer.replace("c", ""));

  const selected = dirIndex.find((d) => d.num === num);
  if (!selected) {
    console.log(chalk.red("  Invalid selection."));
    return;
  }

  const toRestore = closedOnly
    ? selected.sessions.filter((s) => s.status === "closed")
    : selected.sessions;

  const restorable = toRestore.filter((s) => s.sessionId);

  if (restorable.length === 0) {
    console.log(chalk.dim("  No restorable sessions in this directory."));
    return;
  }

  console.log();
  console.log(
    chalk.bold(
      `  Opening ${restorable.length} session(s) from ${basename(selected.cwd)}...`
    )
  );

  await restore({
    tool: undefined,
    cwd: selected.cwd,
    here: false,
    status: closedOnly ? "closed" : "all",
  });
}
