import chalk from "chalk";
import { homedir } from "os";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import { isPidAlive } from "../process.js";

export async function status(): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

  const sessions = await getAllSessions({ status: "active" });
  const home = homedir();
  const shortPath = (p: string) => p.replace(home, "~");

  console.log(chalk.bold("Active sessions:"));
  console.log();

  if (sessions.length === 0) {
    console.log(chalk.dim("  No active sessions."));
    return;
  }

  for (const s of sessions) {
    const display = s.sessionName || s.sessionId?.slice(0, 8) || "unknown";
    const alive = isPidAlive(s.pid);
    const pidStatus = alive
      ? chalk.green("running")
      : chalk.yellow("unknown");

    console.log(
      `  ${chalk.bold(`[${s.tool}]`)} ${display} in ${shortPath(s.cwd)} — PID ${s.pid} (${pidStatus})`
    );
  }
}
