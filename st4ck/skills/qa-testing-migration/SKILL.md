---
name: qa-testing-migration
description: Router skill that classifies legacy tests by migration shape (agentic, components_v1, components_v2, mixed) and dispatches to the correct path skill. Triggers on "migrate these tests", "convert to component format", "modernize tests", "upgrade components". Decides Path A (heavy, LLM-driven) vs Path B (light, mechanical) per test.
---

# QA Testing — Migration Router

You are the **router** that decides HOW each test gets migrated. You don't migrate tests yourself — you classify them, then activate the correct path skill per group.

## Why two paths?

Per plan §13.2 there are two genuinely different migration jobs hiding inside "migrate these tests":

| Shape | What it is | Path | Cost |
|---|---|---|---|
| **agentic** | Every action is `{action, expected}` (legacy free-text). Server has no idea what the test does — only the agent that runs it. | **Path A — heavy** (`qa-testing-migrate-agentic-to-v2`) | ~10k tokens/test (full Agent Teams authoring cycle) |
| **components_v1** | Only `{component, method}` actions, but components use legacy `eval_sequence` (not `sequence`). Mostly metadata + structural upgrade. | **Path B — light** (`qa-testing-upgrade-components-v1-to-v2`) | ~2k tokens/component (mechanical + KB search) |
| **components_v2** | Already on `sequence`. No migration needed. | — | 0 |
| **mixed** | Both shapes coexist in one test. | **Path A — heavy** (LLM has to disentangle) | ~10k tokens/test |
| **empty** | No actions. | — | Skip; flag the test as broken. |

If you blindly run Path A on a Shape-B test you waste 5× the tokens. If you run Path B on a Shape-A test it just fails. The router exists so you never make that mistake.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "process")`** — orchestration rules.

2. **Classify the scope** — call `classify_test_migration_shape({suite_id})` (or `{test_id}` for a single test, or `{scope: "project"}` for the whole project). The MCP tool returns:
   - per-test: `{test_id, test_name, suite_id, shape}`
   - aggregate: `{counts, total, estimated_token_budget, avg_components_per_test}`

3. **Show the user the classification + budget** — *"Suite has X agentic, Y components_v1, Z components_v2, W mixed, V empty. Estimated budget: ~$N. Proceed?"*. Wait for human approval before fanning out.

## Dispatch

Per the classification:

| Group | Activate skill |
|---|---|
| `agentic` + `mixed` | `qa-testing-migrate-agentic-to-v2` (Path A) |
| `components_v1` | `qa-testing-upgrade-components-v1-to-v2` (Path B) |
| `components_v2` | report as already migrated; skip |
| `empty` | report as broken; do not migrate |

Pass the matching test IDs to each skill.

## Failure cascade — Path B may demote to Path A

Path B can encounter cases it cannot handle mechanically:
- Component uses an exotic eval that doesn't map to a primitive
- Component contains a persisted snapshot ref that the server now rejects
- Component cites an unreachable git path
- TRIAD enforcement fails on save

In each case Path B returns a `demote_to_path_a` verdict for that test. The router catches it and re-dispatches the test through Path A.

## Order

Author for parallelism but **do not auto-fan-out** — the user must approve the budget after classification. After approval, run Path A and Path B in parallel (they don't share state); within each path, tests can also run in parallel up to the per-path concurrency budget.

## Don't

- Don't skip the classification. The whole point of the router is the classification.
- Don't override the human gate. If they say "no, hold on the agentic ones," respect it.
- Don't fold both paths into a single LLM dispatch. The whole reason Path B exists is to NOT pay LLM costs for tests that don't need them.
- Don't run Path A on a Shape-B test "because it's safer." Path A on Shape-B does the same work the agent already did — wasted spend.

## Return to the user

A summary table:

```
Suite: <name>
  Path A migrations: M signed / N total
  Path B upgrades:   K signed / L total
  Path B → A demotions: D
  Skipped (already v2):  S
  Skipped (empty):       E
  Estimated total spend: $X
  Actual spend:          $Y
```

Plus: per-test verdict with link to the test in the st4ck UI.
