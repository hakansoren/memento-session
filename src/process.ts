import { execSync } from "child_process";

export function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    const cmdName = execSync(`ps -p ${pid} -o comm=`, { encoding: "utf-8" }).trim();
    return cmdName.includes("claude") || cmdName.includes("codex");
  } catch {
    return false;
  }
}

export function getCwd(pid: number): string | null {
  try {
    const output = execSync(`lsof -a -p ${pid} -d cwd -Fn`, {
      encoding: "utf-8",
    });
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.startsWith("n/")) {
        return line.slice(1);
      }
    }
    return null;
  } catch {
    return null;
  }
}
