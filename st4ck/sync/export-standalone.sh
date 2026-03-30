#!/bin/bash
# Export generic subset of st4ck plugin to the standalone po-research-plugin repo.
# Run from the st4ck-plugin repo root.
#
# Usage: ./sync/export-standalone.sh [path-to-po-research-plugin]
# Default: ../po-research-plugin

set -euo pipefail

# Resolve script location to find plugin files regardless of cwd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"  # st4ck/ directory

TARGET="${1:-../po-research-plugin}"

if [ ! -d "$TARGET" ]; then
  echo "Error: Target repo not found at $TARGET"
  echo "Usage: $0 [path-to-po-research-plugin]"
  exit 1
fi

echo "Syncing to $TARGET..."

# Core research phases (shared source of truth)
cp "$PLUGIN_DIR/shared/po-research-core.md" "$TARGET/shared/po-research-core.md"

# Agent definitions (shared between both plugins)
cp "$PLUGIN_DIR/agents/codebase-explorer.md" "$TARGET/agents/code-explorer.md"
cp "$PLUGIN_DIR/agents/solution-analyst.md" "$TARGET/agents/solution-analyst.md"

echo "Synced 3 files:"
echo "  shared/po-research-core.md  → shared/po-research-core.md"
echo "  agents/codebase-explorer.md → agents/code-explorer.md"
echo "  agents/solution-analyst.md  → agents/solution-analyst.md"
echo ""
echo "Next: cd $TARGET && git add -A && git commit -m 'sync from st4ck' && git push"
