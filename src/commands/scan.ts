import chalk from "chalk";
import { ensureDirs } from "../store.js";
import { scanClaudeSessions, scanCodexSessions } from "../scanners/index.js";
import { cleanupStaleSessions } from "../stale.js";

export async function scan(): Promise<void> {
  await ensureDirs();

  console.log(chalk.bold("Scanning for sessions..."));

  const claude = await scanClaudeSessions();
  const codex = await scanCodexSessions();
  const cleaned = await cleanupStaleSessions();

  const total = claude + codex;
  console.log(
    `${chalk.green("✓")} Scan complete. Found ${total} new session(s)` +
      (cleaned > 0 ? `, cleaned ${cleaned} stale.` : ".")
  );
}
