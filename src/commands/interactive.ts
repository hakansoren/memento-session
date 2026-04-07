import chalk from "chalk";
import { homedir } from "os";
import { basename } from "path";
import { ensureDirs, getAllSessions } from "../store.js";
import { cleanupStaleSessions } from "../stale.js";
import { scanClaudeSessions, scanCodexSessions } from "../scanners/index.js";
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

// ─── Interactive TUI ───

interface SelectResult {
  sessions: Session[];
  yolo: boolean;
}

async function interactiveSelect(groups: DirGroup[]): Promise<SelectResult> {
  // Two modes: "projects" view and "sessions" view (inside a project)
  let mode: "projects" | "sessions" = "projects";
  let cursor = 0;
  let yolo = false;

  // Project-level selections: map of group index -> set of session indices (or "all")
  const selectedSessions = new Map<number, Set<number>>();

  // Which group is expanded in session mode
  let expandedGroup = -1;
  let sessionCursor = 0;

  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);
  const totalActive = groups.reduce((sum, g) => sum + g.activeCount, 0);
  const totalClosed = groups.reduce((sum, g) => sum + g.closedCount, 0);

  const getSelectedCount = (): number => {
    let count = 0;
    for (const [gi, indices] of selectedSessions) {
      count += indices.size;
    }
    return count;
  };

  const isSessionSelected = (gi: number, si: number): boolean => {
    return selectedSessions.get(gi)?.has(si) ?? false;
  };

  const toggleSession = (gi: number, si: number): void => {
    if (!selectedSessions.has(gi)) {
      selectedSessions.set(gi, new Set());
    }
    const set = selectedSessions.get(gi)!;
    if (set.has(si)) {
      set.delete(si);
      if (set.size === 0) selectedSessions.delete(gi);
    } else {
      set.add(si);
    }
  };

  const toggleAllInGroup = (gi: number): void => {
    const group = groups[gi];
    const set = selectedSessions.get(gi);
    if (set && set.size === group.sessions.length) {
      selectedSessions.delete(gi);
    } else {
      selectedSessions.set(gi, new Set(group.sessions.map((_, i) => i)));
    }
  };

  const isGroupFullySelected = (gi: number): boolean => {
    const set = selectedSessions.get(gi);
    return set !== undefined && set.size === groups[gi].sessions.length;
  };

  const isGroupPartiallySelected = (gi: number): boolean => {
    const set = selectedSessions.get(gi);
    return set !== undefined && set.size > 0 && set.size < groups[gi].sessions.length;
  };

  const render = () => {
    process.stdout.write("\x1B[2J\x1B[H");

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

    if (mode === "projects") {
      groups.forEach((group, i) => {
        const isCursor = i === cursor;
        const prefix = isCursor ? chalk.cyan("❯ ") : "  ";

        let checkbox: string;
        if (isGroupFullySelected(i)) {
          checkbox = chalk.green("◉");
        } else if (isGroupPartiallySelected(i)) {
          checkbox = chalk.yellow("◐");
        } else {
          checkbox = chalk.dim("○");
        }

        const dirName = isCursor ? chalk.bold.white(group.name) : chalk.white(group.name);
        const path = chalk.dim(`(${shortPath(group.cwd)})`);

        const statusParts: string[] = [];
        if (group.activeCount > 0) statusParts.push(chalk.green(`${group.activeCount} active`));
        if (group.closedCount > 0) statusParts.push(chalk.yellow(`${group.closedCount} closed`));

        const selectedInGroup = selectedSessions.get(i)?.size || 0;
        const selLabel = selectedInGroup > 0 ? chalk.cyan(` [${selectedInGroup}/${group.sessions.length}]`) : "";

        console.log(`${prefix}${checkbox} ${dirName} ${path} — ${statusParts.join(", ")}${selLabel}`);

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
      const yoloStatus = yolo
        ? chalk.red.bold("  [Y] YOLO: ON") + chalk.dim(" (permissions bypassed)")
        : chalk.dim("  [Y] YOLO: OFF");
      console.log(yoloStatus);

      console.log();
      console.log(chalk.dim("  ↑↓ Navigate   Space Select all in project   → Pick individual sessions"));
      console.log(chalk.dim("  A  Select all  Y Toggle YOLO   Enter Restore   Q Quit"));

    } else {
      // Session-level view
      const group = groups[expandedGroup];
      console.log(chalk.bold(`  ${group.name}`) + chalk.dim(` (${shortPath(group.cwd)})`));
      console.log(chalk.dim(`  ← Back to projects`));
      console.log();

      group.sessions.forEach((s, i) => {
        const isCursor = i === sessionCursor;
        const isSel = isSessionSelected(expandedGroup, i);

        const prefix = isCursor ? chalk.cyan("  ❯ ") : "    ";
        const checkbox = isSel ? chalk.green("◉") : chalk.dim("○");
        const statusIcon = s.status === "active" ? chalk.green("●") : chalk.yellow("○");
        const name = s.sessionName || s.sessionId?.slice(0, 8) || "?";
        const started = s.startedAt.slice(0, 16).replace("T", " ");

        console.log(`${prefix}${checkbox} ${statusIcon} ${chalk.dim(`[${s.tool}]`)} ${isCursor ? chalk.bold.white(name) : name} ${chalk.dim(`— ${started}`)}`);
      });

      console.log();
      console.log(chalk.dim("  ↑↓ Navigate   Space Toggle session   A Select all   ← Back   Enter Restore"));
    }

    const selCount = getSelectedCount();
    if (selCount > 0) {
      console.log();
      console.log(chalk.bold(`  ${selCount} session(s) selected`));
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

    const collectSelected = (): Session[] => {
      const result: Session[] = [];
      for (const [gi, indices] of selectedSessions) {
        for (const si of indices) {
          result.push(groups[gi].sessions[si]);
        }
      }
      return result;
    };

    stdin.on("data", (key: string) => {
      if (key === "\u0003") { cleanup(); process.stdout.write("\x1B[2J\x1B[H"); process.exit(0); }
      if (key === "q" || key === "Q") { cleanup(); process.stdout.write("\x1B[2J\x1B[H"); resolve({ sessions: [], yolo }); return; }

      if (mode === "projects") {
        // Up
        if (key === "\u001B[A" || key === "k") cursor = Math.max(0, cursor - 1);
        // Down
        if (key === "\u001B[B" || key === "j") cursor = Math.min(groups.length - 1, cursor + 1);
        // Space — toggle all sessions in current project
        if (key === " ") toggleAllInGroup(cursor);
        // Right arrow or Enter on empty selection — go to session picker
        if (key === "\u001B[C" || key === "l") {
          expandedGroup = cursor;
          sessionCursor = 0;
          mode = "sessions";
        }
        // A — select/deselect all
        if (key === "a" || key === "A") {
          const allSelected = groups.every((_, i) => isGroupFullySelected(i));
          if (allSelected) {
            selectedSessions.clear();
          } else {
            groups.forEach((g, i) => selectedSessions.set(i, new Set(g.sessions.map((_, si) => si))));
          }
        }
        // Y — toggle yolo
        if (key === "y" || key === "Y") yolo = !yolo;
        // Enter — restore
        if (key === "\r" || key === "\n") {
          cleanup();
          process.stdout.write("\x1B[2J\x1B[H");

          let sessions = collectSelected();
          // If nothing selected, select all from cursor project
          if (sessions.length === 0) {
            sessions = groups[cursor].sessions;
          }
          resolve({ sessions, yolo });
          return;
        }

      } else {
        // Session-level view
        const group = groups[expandedGroup];
        // Up
        if (key === "\u001B[A" || key === "k") sessionCursor = Math.max(0, sessionCursor - 1);
        // Down
        if (key === "\u001B[B" || key === "j") sessionCursor = Math.min(group.sessions.length - 1, sessionCursor + 1);
        // Space — toggle individual session
        if (key === " ") toggleSession(expandedGroup, sessionCursor);
        // Left arrow — back to projects
        if (key === "\u001B[D" || key === "h" || key === "\u001B") {
          mode = "projects";
        }
        // A — select/deselect all in this group
        if (key === "a" || key === "A") toggleAllInGroup(expandedGroup);
        // Y — toggle yolo
        if (key === "y" || key === "Y") yolo = !yolo;
        // Enter — restore
        if (key === "\r" || key === "\n") {
          cleanup();
          process.stdout.write("\x1B[2J\x1B[H");

          let sessions = collectSelected();
          if (sessions.length === 0) {
            sessions = [group.sessions[sessionCursor]];
          }
          resolve({ sessions, yolo });
          return;
        }
      }

      render();
    });
  });
}

// ─── Main interactive ───

export async function interactive(): Promise<void> {
  await ensureDirs();
  await scanClaudeSessions();
  await scanCodexSessions();
  await cleanupStaleSessions();

  const sessions = await getAllSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim("No sessions found."));
    return;
  }

  const groups = groupByDirectory(sessions);

  if (!process.stdin.isTTY) {
    console.log(chalk.dim("Non-interactive mode. Use 'memento list' or 'memento restore'."));
    return;
  }

  const result = await interactiveSelect(groups);

  if (result.sessions.length === 0) return;

  console.log(chalk.bold(`Restoring ${result.sessions.length} session(s)...`));
  console.log();

  // Build a temporary session list and call restore with pre-selected sessions
  await restoreSessions(result.sessions, result.yolo);
}

// Direct restore with a pre-selected session list
async function restoreSessions(sessions: Session[], yolo: boolean): Promise<void> {
  // Write session IDs to a format restore understands
  // We call restore for each unique cwd group
  const byCwd = new Map<string, Session[]>();
  for (const s of sessions) {
    const existing = byCwd.get(s.cwd) || [];
    existing.push(s);
    byCwd.set(s.cwd, existing);
  }

  // For simplicity, restore all selected sessions together
  await restore({
    status: "all",
    yolo,
    _sessions: sessions, // pass directly
  } as any);
}
