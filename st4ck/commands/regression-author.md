---
description: Author regression test suites for shipped features — protects what already works. Explicit form of the qa-testing-regression skill.
argument-hint: <module name | "full-app" | st4ck PRD node ID>
---

# /regression-author

This command is the explicit form of the **`qa-testing-regression`** skill. The skill auto-activates on free-text intent ("create regression tests for X", "add regression coverage for Y") — this slash command is the muscle-memory alternative.

## What to do

Activate the `qa-testing-regression` skill and follow its journey. The user's `$ARGUMENTS` is the scope (module name, `full-app`, or a PRD node UUID).

Do NOT duplicate the skill's journey here. The skill orchestrates: scope detection → explore app + code → KB search → propose scope + human gate → dispatch qa-author → dispatch qa-reviewer → coverage report.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`) and are fetched on demand by sub-agents via `get_qa_methodology`. Nothing to duplicate here.
