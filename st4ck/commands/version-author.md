---
description: Author version tests for in-development features — tests that go GREEN as implementation lands phase-by-phase. Explicit form of the qa-testing-version skill.
argument-hint: <plan path | plan_phase ID | dev_task ID | feature name>
---

# /version-author

This command is the explicit form of the **`qa-testing-version`** skill. The skill auto-activates on free-text intent ("write tests for this feature", "version tests for this plan", "test coverage for this implementation") — this slash command is the muscle-memory alternative when you want to invoke it deliberately.

## What to do

Activate the `qa-testing-version` skill and follow its journey. The user's `$ARGUMENTS` is the scope — usually one of:

- A path to a development plan markdown file (the skill reads its Journey table)
- A `plan_phase` UUID (skill loads its scope from the plan tree)
- A `dev_task` UUID (skill derives the gating phase from the task's plan link)
- A free-text feature description (skill maps it to a plan-phase via `search_prd` / `get_dev_tasks`)

Do NOT duplicate the skill's journey here. The skill orchestrates:

- read the plan-phase Journey table verbatim (test contract)
- dispatch `authoring-lead` (Phase 4 §4.2 Agent Teams pattern) with the plan-phase + dev_task context
- the lead authors tests with `gates_on_plan_phase = <phase_id>` set per §4.6 + §4.7 (tests stay red until phase ships)
- intent_sources populated from the plan's user-journey row + the dev_task (§5.1; reviewer's 13th attestation hard-blocks sign without it)
- dispatch `qa-reviewer` for sign (independent attester, must NOT be the author)
- coverage report tying each authored test to its plan-phase row

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`) and are fetched on demand by sub-agents via `get_qa_methodology`. Nothing to duplicate here.

## Difference vs `/regression-author`

| | `/regression-author` | `/version-author` |
|---|---|---|
| Target | shipped behavior (protect what works) | in-development feature (drive what's being built) |
| Sign trigger | smoke passes at author time → sign immediately | smoke passes only after `dev_task.status='shipped'` per §4.7 → eligible for sign |
| `gates_on_plan_phase` | not set | required, set to the phase UUID |
| Intent source | PRD module / spec section / journey | dev plan's journey row + the gating dev_task |

Pair with the `/implement` Track B flow when working through a TDD-style development plan.
