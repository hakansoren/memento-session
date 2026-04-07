import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { CLAUDE_SESSIONS_DIR } from "../paths.js";
import { getAllSessions, writeSession, createSessionId } from "../store.js";
import { isPidAlive } from "../process.js";
import type { ClaudeSessionFile, Session } from "../types.js";

export async function scanClaudeSessions(): Promise<number> {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return 0;

  let files: string[];
  try {
    files = (await readdir(CLAUDE_SESSIONS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }

  const existing = await getAllSessions({ tool: "claude" });
  const existingSessionIds = new Set(
    existing.map((s) => s.sessionId).filter(Boolean)
  );

  let discovered = 0;

  for (const file of files) {
    try {
      const raw = await readFile(join(CLAUDE_SESSIONS_DIR, file), "utf-8");
      const data = JSON.parse(raw) as ClaudeSessionFile;

      if (!data.sessionId || !data.pid) continue;
      if (existingSessionIds.has(data.sessionId)) continue;

      const alive = isPidAlive(data.pid);
      const startedAt = data.startedAt
        ? new Date(data.startedAt).toISOString()
        : new Date().toISOString();

      let tty = "";
      try {
        tty = execSync(`ps -p ${data.pid} -o tty=`, {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
      } catch {}

      const session: Session = {
        id: createSessionId(),
        tool: "claude",
        sessionId: data.sessionId,
        sessionName: data.name || null,
        cwd: data.cwd,
        pid: data.pid,
        tty,
        startedAt,
        endedAt: alive ? null : startedAt,
        status: alive ? "active" : "closed",
        command: "claude",
      };

      await writeSession(session);
      existingSessionIds.add(data.sessionId);
      discovered++;
    } catch {
      continue;
    }
  }

  return discovered;
}
