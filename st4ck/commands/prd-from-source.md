---
description: Author a Product Requirements Document by reading source code rather than asking the user. Source-grounded, self-contained, works with or without an app.st4ck.io connection.
argument-hint: <path/to/source | "free-text scope hint">
---

# /st4ck:prd-from-source

This command is the explicit form of the **`prd-from-source`** skill. The skill auto-activates on free-text intent ("write a PRD for this codebase", "reverse-engineer a PRD from the export") — this slash command is the muscle-memory alternative.

## What to do

Activate the `prd-from-source` skill. The user's `$ARGUMENTS` is one of:

- A path to the source root to walk
- A short scope hint ("just the billing module", "use the Bubble export at /exports/2026-05-15/")
- Empty (skill begins with Phase 0 preliminaries and walks the user through the anchor questions)

Do NOT duplicate the skill's procedure here. The skill is self-contained — it bundles its foundational PRD-authoring rules, handles Phase 0 with or without an `app.st4ck.io` MCP connection, and runs the two-pass mechanical-scaffold + curated-intent flow.

After authoring is complete, pair with **`/st4ck:prd-review`** to run the four-phase review pipeline before treating the PRD as ready for consumption.
