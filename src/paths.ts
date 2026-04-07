import { homedir } from "os";
import { join } from "path";

const home = homedir();

export const MEMENTO_DIR = process.env.MEMENTO_HOME || join(home, ".memento");
export const SESSIONS_DIR = join(MEMENTO_DIR, "sessions");
export const SNAPSHOTS_DIR = join(MEMENTO_DIR, "snapshots");
export const CONFIG_FILE = join(MEMENTO_DIR, "config.json");

export const CLAUDE_SESSIONS_DIR = join(home, ".claude", "sessions");
export const CODEX_SESSIONS_DIR = join(home, ".codex", "sessions");
