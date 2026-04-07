import { readdir, readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { SESSIONS_DIR, SNAPSHOTS_DIR } from "./paths.js";
import type { Session, SessionFilter, Snapshot } from "./types.js";

export async function ensureDirs(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(SNAPSHOTS_DIR, { recursive: true });
}

export async function readSession(filePath: string): Promise<Session | null> {
  try {
    const data = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed.id || !parsed.tool) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

export async function writeSession(session: Session): Promise<void> {
  await ensureDirs();
  const filePath = join(SESSIONS_DIR, `${session.id}.json`);
  const tmp = `${filePath}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(session, null, 2));
  await rename(tmp, filePath);
}

export async function getAllSessions(
  filter: SessionFilter = {}
): Promise<Session[]> {
  if (!existsSync(SESSIONS_DIR)) return [];

  const files = await readdir(SESSIONS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const sessions: Session[] = [];

  for (const file of jsonFiles) {
    const session = await readSession(join(SESSIONS_DIR, file));
    if (!session) continue;

    if (filter.status && filter.status !== "all" && session.status !== filter.status) continue;
    if (filter.tool && filter.tool !== "all" && session.tool !== filter.tool) continue;
    if (filter.cwd && session.cwd !== filter.cwd && !session.cwd.startsWith(filter.cwd + "/")) continue;

    sessions.push(session);
  }

  return sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export async function saveSnapshot(sessions: Session[]): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const snapshot: Snapshot = {
    timestamp: new Date().toISOString(),
    sessions,
  };
  const filePath = join(SNAPSHOTS_DIR, `${ts}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2));
  return ts;
}

export function createSessionId(): string {
  return randomUUID();
}
