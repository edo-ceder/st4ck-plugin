#!/usr/bin/env bash
#
# Phase 5 §5.2 — opt-in PostToolUse hook for Edit/Write events.
#
# Detects when a Claude Code session has edited a file whose path appears in
# any test_components.selector_notes.source_citations row, then auto-invokes
# the `/st4ck:impact` skill to surface affected tests as test_design_change
# dev_tasks.
#
# Default: OFF. Enable per-project by adding to your settings:
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": { "tool_name": "Edit|Write" },
#         "hooks": [{
#           "type": "command",
#           "command": "${CLAUDE_PLUGIN_ROOT}/hooks/post-edit-scan.sh"
#         }]
#       }
#     ]
#   }
#
# `${CLAUDE_PLUGIN_ROOT}` resolves to the live st4ck-plugin source directory
# (set by Claude Code when the plugin is loaded — works for both directory-
# source marketplace installs and the cache layout). Do NOT hard-code
# `~/.claude/plugins/cache/st4ck-marketplace/...` — that path is a stale
# leftover and won't receive plugin updates.
#
# Reads the Edit/Write tool's `file_path` from $CLAUDE_TOOL_INPUT_PATH (a JSON
# blob). Greps the local component-citation index file (built lazily on first
# run via the MCP tool `get_components`). On match: prints a one-line
# notification + invokes the impact skill.

set -euo pipefail

# Bail early if the env doesn't carry a project dir.
if [[ -z "${CLAUDE_PROJECT_DIR:-}" ]]; then
    exit 0
fi

# Bail if no tool-input env (shouldn't happen for Edit/Write but defensively).
if [[ -z "${CLAUDE_TOOL_INPUT_PATH:-}" ]]; then
    exit 0
fi

# Pull the changed file path from the tool input JSON.
# CLAUDE_TOOL_INPUT_PATH points at a tmp file containing the tool args JSON.
if [[ ! -r "$CLAUDE_TOOL_INPUT_PATH" ]]; then
    exit 0
fi

CHANGED_PATH="$(grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' "$CLAUDE_TOOL_INPUT_PATH" | head -n 1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"

if [[ -z "$CHANGED_PATH" ]]; then
    exit 0
fi

# Convert to repo-relative path. Strip the project dir prefix if present.
case "$CHANGED_PATH" in
    "$CLAUDE_PROJECT_DIR"/*)
        REL_PATH="${CHANGED_PATH#$CLAUDE_PROJECT_DIR/}"
        ;;
    *)
        REL_PATH="$CHANGED_PATH"
        ;;
esac

# Look up the citation index. The index is a single file at
# .st4ck/citations.txt — one citation path per line. It's refreshed lazily
# by `/st4ck:impact` on first invocation per session (the skill calls
# get_components and writes the unique paths).
CITATION_INDEX="$CLAUDE_PROJECT_DIR/.st4ck/citations.txt"
if [[ ! -r "$CITATION_INDEX" ]]; then
    # No index yet — first run hasn't happened. Don't auto-invoke; let the
    # user trigger /st4ck:impact manually so the index gets seeded.
    exit 0
fi

# Match exact or path-prefix.
if grep -qxF "$REL_PATH" "$CITATION_INDEX" 2>/dev/null; then
    # Match. Surface a one-line notification (stderr is read by Claude Code).
    echo "[st4ck:impact] Edited file '$REL_PATH' is cited by ≥1 test component. Run /st4ck:impact to surface affected tests as dev_tasks." >&2

    # Don't actually auto-invoke the skill from here — Claude Code's hook model
    # surfaces stderr to the agent, but agents drive their own skills. The
    # notification is the trigger; the agent decides whether to follow up.
fi

exit 0
