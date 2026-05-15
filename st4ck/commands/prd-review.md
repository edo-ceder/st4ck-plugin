---
description: Review a PRD end-to-end. Self-review → 3 parallel independent reviewers (PO / QA / Dev) → known-gaps-vs-code → bug-routing. Converges on diminishing returns.
argument-hint: <path/to/docs/prd | st4ck PRD document UUID>
---

# /st4ck:prd-review

This command is the explicit form of the **`prd-review`** skill. The skill auto-activates after a PRD module set is authored ("review the PRD", "is this PRD ready?") — this slash command is the muscle-memory alternative.

## What to do

Activate the `prd-review` skill. The user's `$ARGUMENTS` is one of:

- A path to a `docs/prd/` tree on disk
- A st4ck PRD document UUID (when connected to `app.st4ck.io`)
- Empty (skill asks which PRD to review)

Do NOT duplicate the skill's pipeline here. The skill orchestrates the four phases inline:

1. Author self-review against the checklist.
2. Dispatch three independent reviewer subagents in parallel (`prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev`) with no cross-pollination.
3. Re-resolve every KNOWN_GAPS item against the source code before deferring.
4. Route real product bugs to dev tasks (or `BUGS.md` if no tracker is connected).

The loop runs until diminishing returns. Reviewer agents are read-only with constrained tool surfaces — they cannot modify the PRD they're reviewing.
