#!/bin/bash
# =============================================================================
# Sub-agent Verify-Before-Act Reminder Hook
# =============================================================================
# PURPOSE:
#   Fires after any Agent tool call (sub-agent dispatch) and injects a short
#   reminder into the orchestrator's next-turn context:
#
#     "Before filing a dev_task, st4ck issue, or accepting this sub-agent's
#      'can't' / 'doesn't exist' / 'blocked' claim, verify the load-bearing
#      claim yourself with a direct tool call."
#
# WHY:
#   Orchestrators systematically accept sub-agent verdicts and act on them
#   (file tickets, give up on tests, retire features) without verifying the
#   load-bearing claim. This pattern fed FIVE separate sub-agent-related bugs
#   in a single Ori session (st4ck issues a617eca9, 5ad916d2, 4797f9d7,
#   ef715e2a, 7a03ce10). Memory rules don't get re-read at the decision
#   point. A hook makes the rule physically visible at the moment it matters.
#
# OPT-IN (off by default — set in your shell profile to enable):
#   export ST4CK_HOOKS_SUB_AGENT_VERIFY_REMINDER=true
#
# REGISTERED IN:
#   st4ck/hooks/hooks.json — PostToolUse matcher on tool name "Task"
#   (Claude Code's internal tool name for the Agent / sub-agent dispatch).
#
# INPUT (stdin, Claude Code hook protocol):
#   { "tool_name": "Task", "tool_input": {...}, "tool_response": {...} }
#
# OUTPUT (stdout, injected as <system-reminder> when the env var is set):
#   The reminder text.
#
# EXIT 0 always — never block the orchestrator's next turn.
# =============================================================================

set -uo pipefail

# Drain stdin so the hook host doesn't EPIPE on us.
input=$(cat)

# Opt-in gate. Silently no-op when not enabled.
flag="${ST4CK_HOOKS_SUB_AGENT_VERIFY_REMINDER:-}"
case "$flag" in
  true|TRUE|1|yes|YES) ;;
  *) exit 0 ;;
esac

# Filter: only fire on Agent / Task tool calls. Defensive — the hook entry
# in hooks.json already matches on "Task", but in case the matcher behavior
# changes upstream, double-check the tool_name field of the input envelope.
tool_name=$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
case "$tool_name" in
  Task|Agent) ;;
  *) exit 0 ;;
esac

# Emit the reminder. Claude Code's hook protocol injects stdout as a
# <system-reminder> block in the orchestrator's next-turn context.
cat <<'EOF'
⚠ verify-before-act reminder

Before filing a dev_task, st4ck issue, or accepting this sub-agent's
"can't" / "doesn't exist" / "blocked" / "no <X> exists" claim:
verify the load-bearing claim yourself with a direct tool call
(Read, Grep, Bash, st4ck browse, mcp__st4ck-dev/qa/__*, etc.).

Sub-agents systematically optimize for completing the literal brief
over the user's actual outcome — they will report "can't" when the
real answer is "didn't try hard enough" or "wrong premise".

Refs: st4ck issues a617eca9, 5ad916d2, 4797f9d7, ef715e2a, 7a03ce10.
EOF
exit 0
