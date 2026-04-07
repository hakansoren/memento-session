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

interface DirGroup {
  cwd: string;
  name: string;
  sessions: Session[];
  activeCount: number;
  closedCount: number;
}

function groupByDirectory(sessions: Session[]): DirGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const existing = map.get(s.cwd) || [];
    existing.push(s);
    map.set(s.cwd, existing);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cwd, sessions]) => ({
      cwd,
      name: basename(cwd),
      sessions,
      activeCount: sessions.filter((s) => s.status === "active").length,
      closedCount: sessions.filter((s) => s.status === "closed").length,
    }));
}

// ─── Arrow key interactive selector ───

interface SelectResult {
  selectedDirs: number[];
  yolo: boolean;
}

async function interactiveSelect(groups: DirGroup[]): Promise<SelectResult> {
  const selected = new Set<number>();
  let cursor = 0;
  let yolo = false;

  const render = () => {
    // Move cursor to top and clear
    process.stdout.write("\x1B[2J\x1B[H");

    const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);
    const totalActive = groups.reduce((sum, g) => sum + g.activeCount, 0);
    const totalClosed = groups.reduce((sum, g) => sum + g.closedCount, 0);

    // Logo
    console.log();
    console.log(chalk.bold.cyan("  ███╗   ███╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗ ██████╗ "));
    console.log(chalk.bold.cyan("  ████╗ ████║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗"));
    console.log(chalk.bold.cyan("  ██╔████╔██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║"));
    console.log(chalk.bold.cyan("  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║"));
    console.log(chalk.bold.cyan("  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ╚██████╔╝"));
    console.log(chalk.bold.cyan("  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ "));
    console.log();
    console.log(`  ${chalk.white("Session recovery for Claude Code & Codex CLI")}`);
    console.log(`  ${chalk.dim(`${totalSessions} sessions across ${groups.length} projects`)} ${chalk.dim("—")} ${chalk.green(`${totalActive} active`)}${totalClosed > 0 ? chalk.dim(", ") + chalk.yellow(`${totalClosed} closed`) : ""}`);
    console.log();

    // Directory list
    groups.forEach((group, i) => {
      const isCursor = i === cursor;
      const isSelected = selected.has(i);

      const prefix = isCursor ? chalk.cyan("❯ ") : "  ";
      const checkbox = isSelected ? chalk.green("◉") : chalk.dim("○");
      const dirName = isCursor ? chalk.bold.white(group.name) : chalk.white(group.name);
      const path = chalk.dim(`(${shortPath(group.cwd)})`);

      const statusParts: string[] = [];
      if (group.activeCount > 0) statusParts.push(chalk.green(`${group.activeCount} active`));
      if (group.closedCount > 0) statusParts.push(chalk.yellow(`${group.closedCount} closed`));

      console.log(`${prefix}${checkbox} ${dirName} ${path} — ${statusParts.join(", ")}`);

      // Show sessions under cursor
      if (isCursor) {
        for (const s of group.sessions) {
          const name = s.sessionName || s.sessionId?.slice(0, 8) || "?";
          const statusIcon = s.status === "active" ? chalk.green("●") : chalk.yellow("○");
          const started = s.startedAt.slice(0, 16).replace("T", " ");
          console.log(`     ${statusIcon} ${chalk.dim(`[${s.tool}]`)} ${name} ${chalk.dim(`— ${started}`)}`);
        }
      }
    });

    console.log();

    // Yolo toggle
    const yoloStatus = yolo
      ? chalk.red.bold("  [Y] YOLO mode: ON") + chalk.dim(" (permissions bypassed)")
      : chalk.dim("  [Y] YOLO mode: OFF");
    console.log(yoloStatus);

    console.log();
    console.log(chalk.dim("  ↑↓  Navigate    Space  Select    A  Select all    Y  Toggle YOLO"));
    console.log(chalk.dim("  Enter  Restore selected    Q  Quit"));

    if (selected.size > 0) {
      const totalSelected = [...selected].reduce(
        (sum, i) => sum + groups[i].sessions.length, 0
      );
      console.log();
      console.log(chalk.bold(`  ${totalSelected} session(s) selected from ${selected.size} project(s)`));
    }
  };

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    render();

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeAllListeners("data");
    };

    stdin.on("data", (key: string) => {
      // Ctrl+C
      if (key === "\u0003") {
        cleanup();
        process.stdout.write("\x1B[2J\x1B[H");
        process.exit(0);
      }

      // Q / q - quit
      if (key === "q" || key === "Q") {
        cleanup();
        process.stdout.write("\x1B[2J\x1B[H");
        resolve({ selectedDirs: [], yolo });
        return;
      }

      // Arrow up / k
      if (key === "\u001B[A" || key === "k") {
        cursor = Math.max(0, cursor - 1);
      }

      // Arrow down / j
      if (key === "\u001B[B" || key === "j") {
        cursor = Math.min(groups.length - 1, cursor + 1);
      }

      // Space - toggle selection
      if (key === " ") {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
      }

      // A - select all / deselect all
      if (key === "a" || key === "A") {
        if (selected.size === groups.length) {
          selected.clear();
        } else {
          groups.forEach((_, i) => selected.add(i));
        }
      }

      // Y - toggle yolo
      if (key === "y" || key === "Y") {
        yolo = !yolo;
      }

      // Enter - confirm
      if (key === "\r" || key === "\n") {
        cleanup();
        process.stdout.write("\x1B[2J\x1B[H");

        // If nothing selected, use cursor position
        const dirs = selected.size > 0
          ? [...selected]
          : [cursor];

        resolve({ selectedDirs: dirs, yolo });
        return;
      }

      render();
    });
  });
}

// ─── Main interactive ───

export async function interactive(): Promise<void> {
  await ensureDirs();
  await cleanupStaleSessions();

  const sessions = await getAllSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim("No sessions found. Run 'memento scan' first."));
    return;
  }

  const groups = groupByDirectory(sessions);

  // Check if stdin is a TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    // Fallback to non-interactive list
    console.log(chalk.dim("Non-interactive mode. Use 'memento list' or 'memento restore'."));
    return;
  }

  const result = await interactiveSelect(groups);

  if (result.selectedDirs.length === 0) return;

  const selectedGroups = result.selectedDirs.map((i) => groups[i]);
  const totalSessions = selectedGroups.reduce((sum, g) => sum + g.sessions.length, 0);

  console.log(chalk.bold(`Restoring ${totalSessions} session(s) from ${selectedGroups.length} project(s)...`));
  console.log();

  // Restore each selected directory
  for (const group of selectedGroups) {
    await restore({
      cwd: group.cwd,
      status: "all",
      yolo: result.yolo,
    });
  }
}
