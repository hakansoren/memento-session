<p align="center">
  <img src="https://img.shields.io/npm/v/memento-session?color=blue&label=npm" alt="npm version" />
  <img src="https://img.shields.io/npm/l/memento-session" alt="license" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-brightgreen" alt="platform" />
</p>

```
  ███╗   ███╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗ ██████╗
  ████╗ ████║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗
  ██╔████╔██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║
  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║
  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ╚██████╔╝
  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝

  Session recovery for Claude Code & Codex CLI
```

# memento-session

**Never lose your AI coding sessions again.**

You're deep in a coding session with Claude Code or Codex CLI. Multiple terminals, multiple projects. Then your computer restarts, the terminal crashes, or you accidentally close a tab. All your sessions — gone.

**memento** fixes this. It automatically tracks every Claude Code and Codex CLI session you run, and restores them all with a single command.

---

## The Problem

- Claude Code and Codex CLI sessions live inside your terminal
- Close the terminal = session is gone
- Reboot your computer = all sessions are gone
- You have to manually remember which projects had sessions, find session IDs, and reopen them one by one

## The Solution

```bash
# After reboot, just run:
memento
```

That's it. memento opens an interactive dashboard showing all your projects and sessions. Select a project, hit Enter, and all sessions are restored in split panes — right where you left off.

---

## Install

```bash
npm install -g memento-session
```

### Requirements

| Dependency | Why | Install |
|-----------|-----|---------|
| **Node.js** >= 18 | Runtime | [nodejs.org](https://nodejs.org) |
| **tmux** | Split pane restore | `brew install tmux` |
| **zsh** | Shell hook (auto-tracking) | Default on macOS |
| **zstd** | Reading Codex sessions | `brew install zstd` |

---

## Quick Start

### 1. Initialize

```bash
memento init
```

This creates `~/.memento/` and shows what to add to your `~/.zshrc`.

### 2. Add the shell hook

Add this to your `~/.zshrc` (the exact path is shown by `memento init`):

```bash
# Memento session tracker
source "/path/to/memento-hook.zsh"
```

Then restart your shell: `source ~/.zshrc`

### 3. Scan existing sessions

If you already have Claude Code or Codex sessions running:

```bash
memento scan
```

This discovers all sessions from `~/.claude/sessions/` and `~/.codex/sessions/`.

### 4. Use it

```bash
memento
```

---

## How It Works

```
 YOU                           MEMENTO                        YOUR SESSIONS
  │                               │                               │
  ├── run "claude" ──────────────>│── hook records session ──────>│ tracked
  │                               │                               │
  ├── run "codex" ───────────────>│── hook records session ──────>│ tracked
  │                               │                               │
  ╞══ REBOOT / CRASH ════════════╪═══════════════════════════════╪═════════
  │                               │                               │
  ├── run "memento" ─────────────>│── reads saved sessions ──────>│
  │                               │── opens tmux split panes ────>│ restored!
  │                               │── runs "claude --resume" ────>│
  │                               │── runs "codex resume" ───────>│
  └───────────────────────────────┘                               └─────────
```

### Three layers of tracking:

1. **Shell hook** — Automatically records sessions when you type `claude` or `codex`. Zero effort.
2. **Scanner** — Discovers sessions from Claude/Codex native files. Works even without the hook.
3. **Watch daemon** — Optional background process that scans periodically.

### Restore uses tmux:

Sessions are restored in tmux split panes inside your current terminal. Works in **any terminal** — iTerm2, Warp, Terminal.app, VS Code, Cursor, Alacritty, whatever.

Mouse mode is enabled by default, so you can **click between panes** to switch.

---

## Interactive Dashboard

Just run `memento` with no arguments:

```
  ███╗   ███╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗ ██████╗
  ████╗ ████║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗
  ██╔████╔██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ██║   ██║
  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║
  ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ╚██████╔╝
  ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝

  Session recovery for Claude Code & Codex CLI
  24 sessions across 10 projects — 23 active, 1 closed

❯ ◉ flowly-desktop (~/flowly-desktop) — 7 active
     ● [claude] 3e8634c1 — 2026-04-07 00:53
     ● [claude] 7b87b9d5 — 2026-04-06 11:59
     ● [claude] 5abd0190 — 2026-04-05 17:07
  ○ flowlyai (~/flowlyai) — 3 active
  ○ Lovelace-Android (~/Lovelace-Android) — 4 active
  ○ flowly-app (~/flowly-app) — 2 active

  [Y] YOLO mode: OFF

  ↑↓  Navigate    Space  Select    A  Select all    Y  Toggle YOLO
  Enter  Restore selected    Q  Quit
```

### Controls:

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate between projects |
| `Space` | Select/deselect a project |
| `A` | Select all / deselect all |
| `Y` | Toggle YOLO mode (skip permission prompts) |
| `Enter` | Restore selected sessions |
| `Q` | Quit |

---

## Commands

### Shortcuts

```bash
memento claude              # Restore Claude sessions from current directory
memento claude --all        # Restore Claude sessions from ALL directories
memento codex               # Restore Codex sessions from current directory
memento codex --all         # Restore Codex sessions from ALL directories
```

### Session Management

```bash
memento list                # List all tracked sessions
memento list --active       # Show only running sessions
memento list --closed       # Show only restorable sessions
memento list --tool claude  # Filter by tool
memento list --here         # Filter to current directory
memento list --json         # JSON output
memento status              # Show active sessions with PID status
memento scan                # Discover sessions from Claude/Codex files
```

### Restore Options

```bash
memento restore                          # Restore all closed sessions
memento restore --select                 # Interactive picker
memento restore --last                   # Most recent session only
memento restore --tool claude            # Only Claude sessions
memento restore --here                   # Only from current directory
memento restore --yolo                   # Skip all permission prompts
memento restore --layout even-horizontal # Side-by-side layout
```

### YOLO Mode

Restores sessions with permission bypasses:
- **Claude Code**: adds `--dangerously-skip-permissions`
- **Codex CLI**: adds `--full-auto`

```bash
memento claude --yolo       # Restore without permission prompts
memento restore --yolo      # Same for all sessions
```

Or toggle with `Y` in the interactive dashboard.

### Background Watcher

```bash
memento watch                  # Scan every 30s (foreground)
memento watch --interval 60    # Custom interval
```

---

## Navigating Restored Sessions (tmux)

After restoring, your sessions open in tmux split panes. Here's how to navigate:

| Action | How |
|--------|-----|
| **Switch pane** | Click with mouse (enabled by default) |
| **Switch pane** | `Ctrl+B` then arrow key (`←` `↑` `↓` `→`) |
| **Fullscreen a pane** | `Ctrl+B` then `Z` (toggle) |
| **Detach** (keep running) | `Ctrl+B` then `D` |
| **Reattach** | `tmux attach` |
| **Close a pane** | `Ctrl+B` then `X` |

---

## How Session Data Is Tracked

| Tool | Where sessions are stored | Resume command |
|------|--------------------------|----------------|
| Claude Code | `~/.claude/sessions/*.json` | `claude --resume <session-id>` |
| Codex CLI | `~/.codex/sessions/rollout-*.jsonl.zst` | `codex resume <session-id>` |

Memento stores its own tracking data in `~/.memento/sessions/`.

### Shell Hook

The shell hook (`memento-hook.zsh`) uses zsh's native `preexec`/`precmd` hooks:

- **preexec**: Detects when you run `claude` or `codex`, records the session
- **precmd**: Marks the session as closed when the command exits
- **Backfill**: Reads the tool's native session files to get session IDs

Non-interactive commands (`claude --print`, `codex --help`, etc.) are automatically excluded.

---

## FAQ

**Q: Does this work on Linux?**
A: Yes. tmux + Node.js work on Linux. The shell hook requires zsh.

**Q: Does this work on Windows?**
A: Partially. Scan and list work. Restore requires tmux (available via WSL).

**Q: What if I don't use zsh?**
A: The shell hook is zsh-only, but `memento scan` and `memento watch` discover sessions without the hook.

**Q: Does memento read my conversation data?**
A: No. It only reads session metadata (session ID, working directory, timestamps). It never touches conversation content.

**Q: Can I use this with other AI tools?**
A: Currently supports Claude Code and Codex CLI. More tools can be added.

---

## License

MIT

---

<p align="center">
  Built with Claude Code
</p>
