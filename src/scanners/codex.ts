import { readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { CODEX_SESSIONS_DIR } from "../paths.js";
import { getAllSessions, writeSession, createSessionId } from "../store.js";
import type { CodexSessionMeta, Session } from "../types.js";

function hasZstd(): boolean {
  try {
    execSync("which zstd", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function scanCodexSessions(): Promise<number> {
  if (!existsSync(CODEX_SESSIONS_DIR)) return 0;
  if (!hasZstd()) return 0;

  let files: string[];
  try {
    files = (await readdir(CODEX_SESSIONS_DIR)).filter(
      (f) => f.startsWith("rollout-") && f.endsWith(".jsonl.zst")
    );
  } catch {
    return 0;
  }

  const existing = await getAllSessions({ tool: "codex" });
  const existingSessionIds = new Set(
    existing.map((s) => s.sessionId).filter(Boolean)
  );

  let discovered = 0;

  for (const file of files) {
    try {
      const filePath = join(CODEX_SESSIONS_DIR, file);
      const firstLine = execSync(`zstd -dcq "${filePath}" | head -1`, {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();

      if (!firstLine) continue;

      const meta = JSON.parse(firstLine) as CodexSessionMeta;
      const threadId = meta.session_meta?.thread_id || meta.thread_id || "";
      const cwd = meta.session_meta?.cwd || meta.cwd || "";

      if (!threadId) continue;
      if (existingSessionIds.has(threadId)) continue;

      // Parse timestamp from filename: rollout-YYYY-MM-DDTHH-MM-SS-UUID.jsonl.zst
      const tsPart = file.slice("rollout-".length, "rollout-".length + 19);
      const startedAt = `${tsPart.slice(0, 10)}T${tsPart.slice(11, 13)}:${tsPart.slice(14, 16)}:${tsPart.slice(17, 19)}Z`;

      const session: Session = {
        id: createSessionId(),
        tool: "codex",
        sessionId: threadId,
        sessionName: null,
        cwd,
        pid: 0,
        tty: "",
        startedAt,
        endedAt: null,
        status: "closed",
        command: "codex",
      };

      await writeSession(session);
      existingSessionIds.add(threadId);
      discovered++;
    } catch {
      continue;
    }
  }

  return discovered;
}
