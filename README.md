# memento-session

> Never lose your AI coding sessions again.

Session recovery CLI for **Claude Code** and **OpenAI Codex CLI**. Automatically tracks your sessions and restores them after a reboot, terminal crash, or accidental close — all in tmux panels.

```
  ███╗   ███╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗ ██████╗
  ████╗ ████║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗
  ██╔████╔██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║
  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║
  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ╚██████╔╝
  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝
```

## Install

```bash
npm install -g memento-session
```

## Quick Start

```bash
# Initialize memento
memento init

# Add the shell hook to your ~/.zshrc (shown by init)
source "/path/to/memento-hook.zsh"

# Scan existing sessions from Claude Code and Codex
memento scan

# Launch the interactive dashboard
memento
```

## How It Works

1. **Shell hook** auto-tracks `claude` and `codex` sessions as you use them
2. **Scanner** discovers sessions from `~/.claude/sessions/` and `~/.codex/sessions/`
3. **Restore** reopens sessions in tmux panels with the correct resume commands

```
┌─────────────────────────────────────────────────┐
│  Terminal (iTerm2, Warp, Terminal.app, etc.)     │
│  ┌──────────────────┬──────────────────────┐    │
│  │ claude --resume   │ claude --resume      │    │
│  │ <session-a>       │ <session-b>          │    │
│  ├──────────────────┼──────────────────────┤    │
│  │ codex resume      │ claude --resume      │    │
│  │ <session-c>       │ <session-d>          │    │
│  └──────────────────┴──────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Commands

### Interactive Dashboard

```bash
memento          # Shows all projects with sessions, select to restore
```

### Tool Shortcuts

```bash
memento claude              # Restore Claude sessions from current directory
memento claude --all        # Restore Claude sessions from ALL directories
memento claude --select     # Pick which sessions to restore
memento codex               # Restore Codex sessions from current directory
memento codex --all         # Restore Codex sessions from ALL directories
```

### Session Management

```bash
memento list                # List all tracked sessions
memento list --active       # Show only running sessions
memento list --closed       # Show only closed/restorable sessions
memento list --tool claude  # Filter by tool
memento list --here         # Filter to current directory
memento list --json         # JSON output

memento status              # Show currently active sessions
memento scan                # Discover sessions from Claude/Codex files
memento snapshot            # Save point-in-time snapshot of active sessions
```

### Restore Options

```bash
memento restore                     # Restore all closed sessions
memento restore --select            # Interactive picker
memento restore --last              # Most recent session only
memento restore --tool claude       # Only Claude sessions
memento restore --here              # Only from current directory
memento restore --layout even-horizontal  # Side-by-side layout
```

### Background Watcher

```bash
memento watch                  # Scan every 30s (foreground)
memento watch --interval 60    # Custom interval
```

## Requirements

- **Node.js** >= 18
- **tmux** (for restore) — `brew install tmux`
- **zsh** (for shell hook)
- **zstd** (for Codex session reading) — `brew install zstd`

## Session Data

Memento reads session data from:

| Tool | Source | Resume Command |
|------|--------|---------------|
| Claude Code | `~/.claude/sessions/*.json` | `claude --resume <id>` |
| Codex CLI | `~/.codex/sessions/rollout-*.jsonl.zst` | `codex resume <id>` |

Memento stores its tracking data in `~/.memento/sessions/`.

## Shell Hook

The shell hook (`memento-hook.zsh`) uses zsh's `preexec`/`precmd` hooks to automatically track when you start and stop `claude` or `codex` sessions. It:

- Detects `claude` and `codex` commands before they run
- Records session metadata (tool, cwd, timestamp, TTY)
- Marks sessions as closed when the command exits
- Backfills session IDs from the tool's native session files

Non-interactive commands (e.g., `claude --print`, `codex --help`) are automatically excluded.

## License

MIT
