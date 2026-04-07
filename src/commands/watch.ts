import chalk from "chalk";
import { ensureDirs } from "../store.js";
import { scanClaudeSessions, scanCodexSessions } from "../scanners/index.js";
import { cleanupStaleSessions } from "../stale.js";

interface WatchOptions {
  interval?: string;
}

export async function watch(opts: WatchOptions): Promise<void> {
  await ensureDirs();

  const interval = parseInt(opts.interval || "30") * 1000;

  console.log(
    `${chalk.bold(`Watching for sessions every ${interval / 1000}s`)} (Ctrl+C to stop)`
  );
  console.log();

  const tick = async () => {
    const claude = await scanClaudeSessions();
    const codex = await scanCodexSessions();
    const cleaned = await cleanupStaleSessions();
    const found = claude + codex;

    if (found > 0 || cleaned > 0) {
      const now = new Date().toLocaleTimeString();
      const parts: string[] = [];
      if (found > 0) parts.push(`${found} new`);
      if (cleaned > 0) parts.push(`${cleaned} cleaned`);
      console.log(`  ${chalk.dim(now)} ${parts.join(", ")}`);
    }
  };

  await tick();
  setInterval(tick, interval);
}
