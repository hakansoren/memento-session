# ──────────────────────────────────────────────────────────────
# memento-hook.zsh — Auto-track Claude Code & Codex CLI sessions
# Source this file from your ~/.zshrc
# ──────────────────────────────────────────────────────────────

__MEMENTO_DIR="${MEMENTO_HOME:-$HOME/.memento}"
__MEMENTO_SESSIONS_DIR="$__MEMENTO_DIR/sessions"

# Ensure directories exist
mkdir -p "$__MEMENTO_SESSIONS_DIR" 2>/dev/null

# ─── State variables (per-shell instance) ───
__MEMENTO_TRACKING_ID=""
__MEMENTO_TRACKING_TOOL=""
__MEMENTO_TRACKING_CMD=""
__MEMENTO_TRACKING_START=""

# ─── Utility: check if command is interactive session ───

_memento_is_interactive() {
  local cmd="$1"
  local tool="$2"

  if [[ "$tool" == "claude" ]]; then
    # Skip non-interactive: --print, -p, --help, --version, config, mcp
    [[ "$cmd" =~ (--print|-p[[:space:]]|--help|--version|[[:space:]]config[[:space:]]|[[:space:]]mcp[[:space:]]) ]] && return 1
  elif [[ "$tool" == "codex" ]]; then
    # Skip non-interactive: --help, --version, login, logout, feature, config
    [[ "$cmd" =~ (--help|--version|[[:space:]]login|[[:space:]]logout|[[:space:]]feature|[[:space:]]config) ]] && return 1
  fi

  return 0
}

# ─── Parse session info from command args ───

_memento_parse_claude_args() {
  local cmd="$1"
  local session_id="" session_name="" is_resume=false

  # Parse --resume / -r
  if [[ "$cmd" =~ (--resume|-r)[[:space:]]+([^[:space:]]+) ]]; then
    local val="${match[2]}"
    is_resume=true
    # Check if it's a UUID
    if [[ "$val" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
      session_id="$val"
    else
      session_name="$val"
    fi
  fi

  # Parse --session-id
  if [[ "$cmd" =~ --session-id[[:space:]]+([0-9a-fA-F-]+) ]]; then
    session_id="${match[1]}"
  fi

  # Parse --name / -n
  if [[ "$cmd" =~ (--name|-n)[[:space:]]+([^[:space:]]+) ]]; then
    session_name="${match[2]}"
  fi

  # Parse --continue / -c
  if [[ "$cmd" =~ (--continue|-c)([[:space:]]|$) ]]; then
    is_resume=true
  fi

  echo "${session_id}|${session_name}|${is_resume}"
}

_memento_parse_codex_args() {
  local cmd="$1"
  local session_id="" is_resume=false

  # codex resume [session_id]
  if [[ "$cmd" =~ [[:space:]]resume([[:space:]]+([^[:space:]-][^[:space:]]*))?([[:space:]]|$) ]]; then
    is_resume=true
    session_id="${match[2]:-}"
  fi

  # codex fork [session_id]
  if [[ "$cmd" =~ [[:space:]]fork([[:space:]]+([^[:space:]-][^[:space:]]*))?([[:space:]]|$) ]]; then
    is_resume=true
    session_id="${match[2]:-}"
  fi

  # --last flag
  if [[ "$cmd" =~ --last ]]; then
    is_resume=true
  fi

  echo "${session_id}||${is_resume}"
}

# ─── Backfill session ID from tool's native files ───

_memento_backfill_claude() {
  local tracking_file="$1"
  local start_time="$2"
  local cwd="$3"

  local claude_sessions_dir="$HOME/.claude/sessions"
  [[ -d "$claude_sessions_dir" ]] || return 0

  # Find the most recent Claude session file matching our CWD
  local best_file="" best_time=0

  for pf in "$claude_sessions_dir"/*.json; do
    [[ -f "$pf" ]] || continue

    local pf_cwd pf_sid pf_started pf_pid pf_name
    pf_cwd=$(jq -r '.cwd // ""' "$pf" 2>/dev/null) || continue
    pf_started=$(jq -r '.startedAt // 0' "$pf" 2>/dev/null)

    [[ "$pf_cwd" != "$cwd" ]] && continue

    if [[ "$pf_started" -gt "$best_time" ]]; then
      best_time="$pf_started"
      best_file="$pf"
    fi
  done

  if [[ -n "$best_file" ]]; then
    local sid pid sname
    sid=$(jq -r '.sessionId // ""' "$best_file" 2>/dev/null)
    pid=$(jq -r '.pid // 0' "$best_file" 2>/dev/null)
    sname=$(jq -r '.name // ""' "$best_file" 2>/dev/null)

    local tmp="${tracking_file}.tmp.$$"
    jq \
      --arg sid "$sid" \
      --argjson pid "$pid" \
      --arg sname "$sname" \
      '.session_id = $sid | .pid = $pid | .session_name = (if $sname == "" then .session_name else $sname end)' \
      "$tracking_file" > "$tmp" && mv "$tmp" "$tracking_file"
  fi
}

_memento_backfill_codex() {
  local tracking_file="$1"
  local cwd="$2"

  local codex_sessions_dir="$HOME/.codex/sessions"
  [[ -d "$codex_sessions_dir" ]] || return 0

  # Find the most recent rollout file
  local latest_file=""
  latest_file=$(ls -t "$codex_sessions_dir"/rollout-*.jsonl.zst 2>/dev/null | head -1)
  [[ -z "$latest_file" ]] && return 0

  local meta
  meta=$(zstd -dcq "$latest_file" 2>/dev/null | head -1) || return 0
  [[ -z "$meta" ]] && return 0

  local thread_id meta_cwd
  thread_id=$(echo "$meta" | jq -r '.session_meta.thread_id // .thread_id // ""' 2>/dev/null)
  meta_cwd=$(echo "$meta" | jq -r '.session_meta.cwd // .cwd // ""' 2>/dev/null)

  if [[ -n "$thread_id" && "$meta_cwd" == "$cwd" ]]; then
    local tmp="${tracking_file}.tmp.$$"
    jq --arg sid "$thread_id" '.session_id = $sid' "$tracking_file" > "$tmp" && mv "$tmp" "$tracking_file"
  fi
}

# ─── preexec hook: fires BEFORE a command runs ───

_memento_preexec() {
  local cmd="$1"

  # Extract first word (handle leading spaces, env vars, etc.)
  local first_word
  first_word=$(echo "$cmd" | sed 's/^[[:space:]]*//' | awk '{print $1}')

  # Only track claude and codex
  [[ "$first_word" != "claude" && "$first_word" != "codex" ]] && return

  # Check if this is an interactive session
  _memento_is_interactive "$cmd" "$first_word" || return

  # Generate tracking ID
  __MEMENTO_TRACKING_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
  __MEMENTO_TRACKING_TOOL="$first_word"
  __MEMENTO_TRACKING_CMD="$cmd"
  __MEMENTO_TRACKING_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Parse tool-specific session info
  local parsed session_id="" session_name=""
  if [[ "$first_word" == "claude" ]]; then
    parsed=$(_memento_parse_claude_args "$cmd")
    session_id="${parsed%%|*}"
    local rest="${parsed#*|}"
    session_name="${rest%%|*}"
  else
    parsed=$(_memento_parse_codex_args "$cmd")
    session_id="${parsed%%|*}"
  fi

  # Get TTY
  local tty_name
  tty_name=$(tty 2>/dev/null | sed 's|/dev/||') || tty_name=""

  # Write tracking file
  local tracking_file="$__MEMENTO_SESSIONS_DIR/${__MEMENTO_TRACKING_ID}.json"
  local tmp="${tracking_file}.tmp.$$"

  jq -n \
    --arg id "$__MEMENTO_TRACKING_ID" \
    --arg tool "$__MEMENTO_TRACKING_TOOL" \
    --arg session_id "$session_id" \
    --arg session_name "$session_name" \
    --arg cwd "$PWD" \
    --arg tty "$tty_name" \
    --arg started_at "$__MEMENTO_TRACKING_START" \
    --arg command "$cmd" \
    '{
      id: $id,
      tool: $tool,
      session_id: (if $session_id == "" then null else $session_id end),
      session_name: (if $session_name == "" then null else $session_name end),
      cwd: $cwd,
      pid: 0,
      tty: $tty,
      started_at: $started_at,
      ended_at: null,
      status: "active",
      command: $command
    }' > "$tmp" && mv "$tmp" "$tracking_file" 2>/dev/null

  # Try to capture PID in background after a short delay
  (
    sleep 2
    local found_pid
    found_pid=$(pgrep -n "$first_word" 2>/dev/null) || true
    if [[ -n "$found_pid" && -f "$tracking_file" ]]; then
      local ptmp="${tracking_file}.pid.$$"
      jq --argjson pid "$found_pid" '.pid = $pid' "$tracking_file" > "$ptmp" && mv "$ptmp" "$tracking_file" 2>/dev/null
    fi
  ) &>/dev/null &
  disown 2>/dev/null
}

# ─── precmd hook: fires AFTER a command completes ───

_memento_precmd() {
  # Nothing to clean up if we weren't tracking
  [[ -z "$__MEMENTO_TRACKING_ID" ]] && return

  local tracking_file="$__MEMENTO_SESSIONS_DIR/${__MEMENTO_TRACKING_ID}.json"

  if [[ -f "$tracking_file" ]]; then
    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Mark as closed
    local tmp="${tracking_file}.tmp.$$"
    jq --arg ended "$now" '.ended_at = $ended | .status = "closed"' "$tracking_file" > "$tmp" && mv "$tmp" "$tracking_file" 2>/dev/null

    # Backfill session ID if missing
    local current_sid
    current_sid=$(jq -r '.session_id // ""' "$tracking_file" 2>/dev/null)
    if [[ -z "$current_sid" || "$current_sid" == "null" ]]; then
      if [[ "$__MEMENTO_TRACKING_TOOL" == "claude" ]]; then
        _memento_backfill_claude "$tracking_file" "$__MEMENTO_TRACKING_START" "$PWD"
      elif [[ "$__MEMENTO_TRACKING_TOOL" == "codex" ]]; then
        _memento_backfill_codex "$tracking_file" "$PWD"
      fi
    fi
  fi

  # Reset state
  __MEMENTO_TRACKING_ID=""
  __MEMENTO_TRACKING_TOOL=""
  __MEMENTO_TRACKING_CMD=""
  __MEMENTO_TRACKING_START=""
}

# ─── Register hooks ───

# Add to preexec_functions if not already there
if (( ${+functions[preexec_functions]} )) || [[ -n "${preexec_functions+x}" ]]; then
  if [[ ! " ${preexec_functions[*]} " =~ " _memento_preexec " ]]; then
    preexec_functions+=(_memento_preexec)
  fi
else
  preexec_functions=(_memento_preexec)
fi

# Add to precmd_functions if not already there
if (( ${+functions[precmd_functions]} )) || [[ -n "${precmd_functions+x}" ]]; then
  if [[ ! " ${precmd_functions[*]} " =~ " _memento_precmd " ]]; then
    precmd_functions+=(_memento_precmd)
  fi
else
  precmd_functions=(_memento_precmd)
fi
