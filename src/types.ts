export interface Session {
  id: string;
  tool: "claude" | "codex";
  sessionId: string | null;
  sessionName: string | null;
  cwd: string;
  pid: number;
  tty: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "closed";
  command: string;
}

export interface ClaudeSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
  name?: string;
}

export interface CodexSessionMeta {
  session_meta?: {
    thread_id?: string;
    cwd?: string;
  };
  thread_id?: string;
  cwd?: string;
}

export interface Snapshot {
  timestamp: string;
  sessions: Session[];
}

export interface SessionFilter {
  status?: "active" | "closed" | "all";
  tool?: "claude" | "codex" | "all";
  cwd?: string;
}
