import chalk from "chalk";
import { ensureDirs, getAllSessions, saveSnapshot } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";

export async function snapshot(): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

  const active = await getAllSessions({ status: "active" });

  if (active.length === 0) {
    console.log(chalk.dim("No active sessions to snapshot."));
    return;
  }

  const ts = await saveSnapshot(active);
  console.log(
    `${chalk.green("✓")} Snapshot saved: ${chalk.bold(ts)} (${active.length} sessions)`
  );
}
