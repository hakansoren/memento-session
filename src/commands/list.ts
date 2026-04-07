import chalk from "chalk";
import { homedir } from "os";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import type { SessionFilter } from "../types.js";

interface ListOptions {
  active?: boolean;
  closed?: boolean;
  tool?: string;
  here?: boolean;
  cwd?: string;
  json?: boolean;
}

export async function list(opts: ListOptions): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

  const filter: SessionFilter = {};
  if (opts.active) filter.status = "active";
  else if (opts.closed) filter.status = "closed";
  if (opts.tool) filter.tool = opts.tool as "claude" | "codex";
  if (opts.here) filter.cwd = process.cwd();
  else if (opts.cwd) filter.cwd = opts.cwd;

  const sessions = await getAllSessions(filter);

  if (sessions.length === 0) {
    console.log(chalk.dim("No sessions found."));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  const home = homedir();
  const shortPath = (p: string) => p.replace(home, "~");

  console.log(
    chalk.bold(
      `${"ID".padEnd(10)} ${"TOOL".padEnd(8)} ${"NAME".padEnd(20)} ${"DIRECTORY".padEnd(35)} ${"STATUS".padEnd(10)} STARTED`
    )
  );
  console.log("─".repeat(110));

  for (const s of sessions) {
    const id = s.id.slice(0, 8);
    const name = (s.sessionName || "-").slice(0, 18);
    const cwd = shortPath(s.cwd).slice(0, 33);
    const started = s.startedAt.slice(0, 16).replace("T", " ");
    const statusColor = s.status === "active" ? chalk.green : chalk.yellow;

    console.log(
      `${id.padEnd(10)} ${s.tool.padEnd(8)} ${name.padEnd(20)} ${cwd.padEnd(35)} ${statusColor(s.status.padEnd(10))} ${started}`
    );
  }
}
