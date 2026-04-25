---
description: Phase 5 §5.2 — agent-driven test impact analysis. Reads the local git diff, surfaces every QA test whose components cite the changed lines, queues test_design_change dev_tasks for QA. Optionally generates proposed component updates with --propose.
argument-hint: [--base <branch>] [--staged] [--propose] [--limit <N>]
---

# /st4ck:impact

Activates the `impact` skill. Use when:
- You want to know "what tests does my diff break?" before merging
- You're triaging a refactor and want to surface affected test surface
- You want QA to look at affected tests with proposed updates attached

## What to do

Activate the `impact` skill. The user's `$ARGUMENTS` may include:
- `--base <branch>` — diff against a base branch (default: HEAD^)
- `--staged` — diff staged changes only
- `--propose` — invoke the propose subworkflow per affected component (LLM-driven; expensive)
- `--limit <N>` — cap propose subworkflow output (default 20)

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth (and `propose.md` for the optional second step).

All methodology rules live on the server; this skill is read-mostly + queues dev_tasks via `create_dev_task`.
