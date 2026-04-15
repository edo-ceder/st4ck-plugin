---
description: Migrate legacy agentic tests to component-based format for deterministic execution. Explicit form of the qa-testing-migration skill.
argument-hint: <suite_id | suite_name>
---

# /migrate-tests

This command is the explicit form of the **`qa-testing-migration`** skill. The skill auto-activates on free-text intent ("migrate these tests", "convert to component format", "move off agentic blocks") — this slash command is the muscle-memory alternative.

## What to do

Activate the `qa-testing-migration` skill and follow its journey. The user's `$ARGUMENTS` is the target suite (UUID or name) or empty (list suites with legacy tests and ask).

Do NOT duplicate the skill's journey here. The skill orchestrates: inventory → human gate → KB search → dispatch qa-author (migration intent) → per-test human gate on each migration → save → dispatch qa-reviewer → re-run → report.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`) and are fetched on demand by sub-agents via `get_qa_methodology`. Nothing to duplicate here.
