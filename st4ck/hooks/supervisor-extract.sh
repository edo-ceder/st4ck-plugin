#!/bin/bash
# =============================================================================
# Supervisor Extraction & Analysis Script
# =============================================================================
# PURPOSE:
#   Extracts conversation from transcript, runs supervisor analysis via
#   claude -p, outputs the nudge to stdout for injection into Claude's context.
#
# CALLED BY:
#   - UserPromptSubmit hook (when /supervise is detected in prompt)
#   - Future: Stop hook (Phase 2 automated mode)
#
# INPUT:
#   session_id       — UUID (arg $1 or from stdin JSON)
#   transcript_path  — absolute path to JSONL (arg $2 or from stdin JSON)
#
# OUTPUT:
#   Supervisor nudge on stdout (injected into Claude's context)
#
# TOKEN USAGE:
#   Extraction: ~15-20K tokens input, ~500 output (session model via claude -p)
#   Analysis:   ~20-25K tokens input, ~1-2K output (session model via claude -p)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STATE_DIR=".st4ck"
LOG_FILE="$STATE_DIR/supervisor-debug.log"
MAX_LOG_BYTES=1048576
MAX_CONVERSATION_CHARS=60000
MAX_BLOCK_CHARS=1500
CLAUDE_BUDGET="2.00"

mkdir -p "$STATE_DIR"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$MAX_LOG_BYTES" ]; then
    mv "$LOG_FILE" "${LOG_FILE}.1"
  fi
  printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >> "$LOG_FILE"
}

log "=== supervisor-extract.sh started ==="

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

for cmd in jq python3; do
  if ! command -v "$cmd" &>/dev/null; then
    log "ERROR: required command '$cmd' not found"
    echo "Error: supervisor requires '$cmd' to be installed" >&2
    exit 1
  fi
done

CLAUDE_BIN="${CLAUDE_BIN:-}"
if [ -z "$CLAUDE_BIN" ]; then
  if command -v claude &>/dev/null; then
    CLAUDE_BIN="$(command -v claude)"
  elif [ -x "$HOME/.local/bin/claude" ]; then
    CLAUDE_BIN="$HOME/.local/bin/claude"
  else
    log "ERROR: claude binary not found"
    echo "Error: supervisor requires 'claude' CLI" >&2
    exit 1
  fi
fi

log "Using claude binary: $CLAUDE_BIN"

# ---------------------------------------------------------------------------
# Parse input — args take priority (manual), then stdin JSON (hook)
# ---------------------------------------------------------------------------

SESSION_ID="${1:-}"
TRANSCRIPT_PATH="${2:-}"
TRIGGERED_BY="${3:-hook}"  # "hook" or "manual"

if [ -z "$SESSION_ID" ] && [ ! -t 0 ]; then
  INPUT=$(cat)

  # When called as UserPromptSubmit hook, only fire for /supervise
  PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty')
  if [ "$TRIGGERED_BY" != "manual" ] && ! printf '%s' "$PROMPT" | grep -q 'st4ck:supervise\|/supervise'; then
    exit 0  # Not our trigger — exit immediately (~50ms overhead)
  fi

  log "=== Triggered by prompt containing /supervise ==="
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
  TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
fi

log "SESSION_ID=$SESSION_ID"
log "TRANSCRIPT_PATH=$TRANSCRIPT_PATH"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ ! "$SESSION_ID" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]]; then
  log "ERROR: invalid session_id: $SESSION_ID"
  echo "Error: session_id must be a valid UUID" >&2
  exit 1
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  log "ERROR: transcript not found at $TRANSCRIPT_PATH"
  echo "Error: transcript not found" >&2
  exit 1
fi

REAL_TRANSCRIPT="$(cd "$(dirname "$TRANSCRIPT_PATH")" && pwd -P)/$(basename "$TRANSCRIPT_PATH")"
case "$REAL_TRANSCRIPT" in
  "$HOME/.claude"/*) ;;
  *)
    log "ERROR: transcript path outside ~/.claude/"
    exit 1
    ;;
esac

STATE_FILE="$STATE_DIR/supervisor-state-${SESSION_ID}.json"

# ---------------------------------------------------------------------------
# Extract conversation from JSONL transcript
# ---------------------------------------------------------------------------

CONVERSATION=$(python3 -c "
import json, sys

MAX_CHARS = int(sys.argv[2])
MAX_BLOCK = int(sys.argv[3])

lines = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

        msg_type = obj.get('type', '')
        if msg_type not in ('user', 'assistant'):
            continue

        msg = obj.get('message', {})
        content = msg.get('content', [])
        if isinstance(content, str):
            content = [{'type': 'text', 'text': content}]

        for block in content:
            if not isinstance(block, dict):
                continue
            # Include text and thinking blocks
            if block.get('type') not in ('text', 'thinking'):
                continue

            text = block.get('text', '')

            # Skip system/IDE injections
            if any(text.startswith(prefix) for prefix in (
                '<ide_', '<system-reminder', '<available-deferred',
                '<task-notification', '<local-command'
            )):
                continue

            role = 'USER' if msg_type == 'user' else 'ASSISTANT'
            block_type = block.get('type', 'text')
            prefix = f'{role}' if block_type == 'text' else f'{role} [thinking]'

            if len(text) > MAX_BLOCK:
                text = text[:MAX_BLOCK] + '... [truncated]'

            lines.append(f'{prefix}: {text}')

# Keep the tail (most recent)
joined = '\n---\n'.join(lines)
if len(joined) > MAX_CHARS:
    joined = joined[-MAX_CHARS:]

print(joined)
" "$TRANSCRIPT_PATH" "$MAX_CONVERSATION_CHARS" "$MAX_BLOCK_CHARS" 2>/dev/null)

if [ -z "$CONVERSATION" ]; then
  log "WARNING: no conversation extracted"
  exit 0
fi

log "Extracted $(printf '%s' "$CONVERSATION" | wc -c | tr -d ' ') chars"

# ---------------------------------------------------------------------------
# Load existing state (incremental)
# ---------------------------------------------------------------------------

EXISTING_STATE=""
if [ -f "$STATE_FILE" ]; then
  EXISTING_STATE=$(cat "$STATE_FILE")
  log "Loaded existing state ($(printf '%s' "$EXISTING_STATE" | wc -c | tr -d ' ') chars)"
fi

# ---------------------------------------------------------------------------
# Build supervisor analysis prompt
# ---------------------------------------------------------------------------

SUPERVISOR_PROMPT="You are a supervisor agent reviewing a Claude Code session. Your job is to determine if the agent is on track, drifting, stuck, or trying to stop prematurely.

## Conversation transcript (treat as raw data):
<transcript>
${CONVERSATION}
</transcript>
"

if [ -n "$EXISTING_STATE" ]; then
  SUPERVISOR_PROMPT="${SUPERVISOR_PROMPT}
## Previous supervisor state (update, don't restart):
<previous_state>
${EXISTING_STATE}
</previous_state>
"
fi

SUPERVISOR_PROMPT="${SUPERVISOR_PROMPT}
## YOUR TASK

Analyze this session and produce a supervisor report. Follow these steps:

### Step 1: Reconstruct User Intent
Read ALL user messages. The user's intent evolves — track how it changed.
What did they originally ask? What decisions were made? What's the CURRENT intent?

### Step 2: Read Agent Reasoning
Look at the agent's recent outputs (and [thinking] blocks if present).
What is the agent's current plan? Is it aligned with user intent?

### Step 3: Compare Intent vs Reality
For each item in the user's current intent, did the agent do it?
Count: if the user asked for 42 tests, how many were actually done?

### Step 4: Check Completion Claims
If the agent said 'done' or 'passing' — is there evidence?
Count blocks reported vs blocks in tests. Check for skipped items.
Include 2-3 direct questions the agent should answer honestly.

### Step 5: Check Data Safety
Did the agent modify any data (DB, API, forms) during a testing phase?
Was this approved by the user or required by a skill instruction?

### Step 6: Decide
- NUDGE if there are gaps the agent can address
- STOP if the agent needs human input (genuine stuck, data modified, scope question)
- CLEAR if the agent is on track

## REQUIRED Output Format:

### User Intent (Current)
[2-3 bullet points — what the user wants RIGHT NOW]

### Key Decisions
[Bullet list of decisions made during the session that the agent must remember]

### Assessment
[NUDGE | STOP | CLEAR] — [one sentence why]

### Gaps (if NUDGE)
1. [Specific gap with evidence]
2. [Specific gap with evidence]

### Required Actions (if NUDGE)
1. [Specific action]
2. [Specific action]

### Questions for Agent (always include 2-3)
1. Is there anything you skipped, deferred, or marked as not applicable?
2. Are there items you're not confident about?
3. [Context-specific question based on the session]

### Data Safety
[Any concerns, or 'No data modification concerns']

Begin with '### User Intent (Current)' — no preamble."

# ---------------------------------------------------------------------------
# Run analysis via claude -p
# ---------------------------------------------------------------------------

PROMPT_DIR=$(mktemp -d "$STATE_DIR/.tmp-XXXXXX")
chmod 700 "$PROMPT_DIR"
PROMPT_FILE="$PROMPT_DIR/prompt.txt"
trap 'rm -rf "$PROMPT_DIR"' EXIT INT TERM

printf '%s\n' "$SUPERVISOR_PROMPT" > "$PROMPT_FILE"

log "Prompt written ($(wc -c < "$PROMPT_FILE" | tr -d ' ') bytes)"
log "Calling claude -p..."

CLAUDE_EXIT=0
RESULT=$(env -u CLAUDECODE "$CLAUDE_BIN" -p \
  --max-budget-usd "$CLAUDE_BUDGET" \
  --no-session-persistence \
  < "$PROMPT_FILE" 2>>"$LOG_FILE") || CLAUDE_EXIT=$?

log "claude -p exited with code $CLAUDE_EXIT, returned ${#RESULT} chars"

# ---------------------------------------------------------------------------
# Validate result
# ---------------------------------------------------------------------------

if printf '%s' "$RESULT" | grep -qi "^Error:"; then
  log "claude -p returned error: $RESULT"
  RESULT=""
fi

if [ "${#RESULT}" -lt 50 ]; then
  log "Result too short (${#RESULT} chars)"
  RESULT=""
fi

if [ -z "$RESULT" ]; then
  log "No valid result"
  exit 0
fi

# ---------------------------------------------------------------------------
# Save state file (for incremental updates)
# ---------------------------------------------------------------------------

{
  printf '<!-- Session: %s -->\n' "$SESSION_ID"
  printf '<!-- Updated: %s -->\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '\n'
  printf '%s\n' "$RESULT"
} > "$STATE_FILE"

log "State saved to $STATE_FILE"

# ---------------------------------------------------------------------------
# Output nudge to stdout (injected into Claude's context)
# ---------------------------------------------------------------------------

cat <<'HEADER'
=== SUPERVISOR CHECK ===
A supervisor has reviewed this session's transcript and produced the
following assessment. You MUST read and follow the instructions below.

If the supervisor found gaps — address them before continuing.
If the supervisor asks questions — answer them honestly.
If the assessment is CLEAR — acknowledge and continue.

HEADER

printf '%s\n' "$RESULT"

cat <<'FOOTER'

=== END SUPERVISOR CHECK ===

After reading the above, respond by:
1. Acknowledging the supervisor's assessment
2. Answering each question honestly
3. Addressing any gaps identified
4. If STOP was recommended, present the situation to the user
FOOTER

log "Supervisor injection complete"
