import { getAllSessions, writeSession } from "./store.js";
import { isPidAlive } from "./process.js";

export async function cleanupStaleSessions(): Promise<number> {
  const active = await getAllSessions({ status: "active" });
  let cleaned = 0;

  for (const session of active) {
    if (session.pid > 0 && !isPidAlive(session.pid)) {
      session.status = "closed";
      session.endedAt = new Date().toISOString();
      await writeSession(session);
      cleaned++;
    }
  }

  return cleaned;
}
