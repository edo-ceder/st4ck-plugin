---
name: qa-testing-migrate-agentic-to-v2
description: Path A migration — full Agent Teams re-author cycle for legacy agentic tests (`{action, expected}` blocks) and mixed-shape tests. Runs component discovery + TRIAD-bound component authoring + intent-source binding + 13th attestation. Heavy budget (~10k tokens/test). Triggered by qa-testing-migration router for shape='agentic' or shape='mixed', or invokable directly via `/st4ck:migrate-agentic-to-v2`.
---

# Path A — Migrate Agentic Tests to v2 (Component Format)

You convert ONE legacy test (or batch of tests, all Shape A or C) to the deterministic component format. Heavy path: full Agent Teams re-author cycle.

## When this skill is the right path

The router (`qa-testing-migration`) dispatches you for tests classified as:
- **agentic** — every action is `{action, expected}` legacy free-text. The server doesn't know what the test does at runtime; the agent at run-time reasons it out. Slow + expensive + non-reproducible.
- **mixed** — both legacy `{action, expected}` AND `{component, method}` actions in the same test. The LLM has to disentangle and may need to refactor existing component calls too.

**You should NOT be invoked for shape='components_v1'** — that's Path B (mechanical, much cheaper). If you find yourself looking at a Shape-B test, return `wrong_path` to the router.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "process")`** — orchestration rules + methodology key.

2. **Read the dispatch prompt carefully** — the router told you:
   - `test_id` (or list)
   - The classified shape (`agentic` | `mixed`)
   - Suite ID
   - Project ID
   - Existing component inventory hints (the router may have called `get_components` in summary mode)

## Per-test workflow

For each test in your scope:

### Step 1 — Read the legacy test verbatim

`get_test_details({test_case_id})` → read every `{action, expected}` step. **Do not skip anything.** This is the truth of what the test verifies.

### Step 2 — Author intent_sources from the legacy actions

The new format requires `intent_sources` (≥1 entry at sign time per Phase 5 §5.1). For a legacy test you migrate from, the intent is implicit in the actions. Distill it:

- **First option:** if the test's name + steps clearly map to a PRD node / spec section / dev_task — link those.
- **Second option:** free_text. Write a 1-2 sentence summary of what behavior the test verifies. Example: `{ source_type: 'free_text', source_text: 'verifies that submitting a valid login form returns the dashboard with the user's display name visible', source_id: null }`.

Don't skip this — sign_test_review hard-rejects empty intent_sources.

### Step 3 — Enact the lead role yourself

You ARE the authoring lead — the migration is orchestrated in your context (the current session). Per `shared/authoring-lead-role.md`:

1. Run §4.1 component discovery (`get_component_discovery`) against the legacy test to identify candidates.
2. Dispatch `component-author` teammates per candidate that doesn't exist yet (parallel via multiple `Agent` tool calls in one message).
3. Once components are ready, dispatch a `test-author` teammate to compose the new test from them — pass the legacy test's full scenario_blocks, the intent_sources from Step 2, the suite_id + project_id, and the existing component inventory.
4. When test-author returns green, dispatch a fresh `qa-reviewer` (independence rule).
5. After sign, dispatch `qa-runner` to execute the new test against the target environment.

You manage the loop. Track teammate verdicts. Re-dispatch on stuck. Surface budget overflows up to the router (Step 6).

### Step 4 — Collect teammate verdicts and assemble the migration record

After all teammates return:
```json
{
  "outcome": "success" | "stuck",
  "new_test_case_id": "<uuid>" | null,
  "old_test_case_id": "<the test you migrated>",
  "components_authored": [...],
  "components_reused": [...],
  "smoke_execution_id": "<uuid>" | null,
  "qa_reviewer_signed": true | false,
  "tokens_used": <sum across all teammate dispatches you ran>,
  "evidence": {...}
}
```

### Step 5 — Atomic swap (per §13.2 promote-time discipline)

Per plan §13.4 partial-upgrade preservation: do NOT delete the old test until the new one is signed + has a passing execution. Atomic swap policy:

- If `qa_reviewer_signed === true` AND `tokens_used <= 15000`:
  - Update the OLD test record's `scenario_blocks` to the new component-format blocks
  - Update `linked_execution_id` to the new green execution
  - Update `signed_environments[]` with the new per-env signature entry
  - Set `intent_sources` from the lead's output (which was your Step 2 output validated by qa-reviewer)
  - Clear `legacy_signature` flag
  - Status stays `signed`

- Else (lead got stuck):
  - DO NOT modify the old test
  - Return verdict to the router with the lead's `evidence`

### Step 6 — Token budget enforcement

Per plan §6.0 gate: mean across Shape-A gate tests ≤ 10k tokens. Hard cap per test is 15k (1.5× target — anything beyond signals architectural mismatch).

If a single test exceeds 15k tokens:
- Halt your dispatch loop
- Return verdict `stuck` with `stuck_kind: 'budget_exceeded'`
- Surface to the router for human triage — possibly the test is genuinely too complex, possibly the team is looping

## Demote path

You don't demote to Path B. You ARE the heavy path; if you can't migrate a test, it's a real blocker. Surface to the router with `stuck` verdict + evidence. Router escalates to human.

## Hard rules

- **Never collapse the team into your own context** — don't try to author components or compose tests yourself in this skill's session. Always dispatch leaf teammates (component-author + test-author + qa-reviewer + qa-runner). The whole point of Path A is fan-out for context isolation; if you collapse it back you lose the benefit.
- **Never sign your own migration.** Always dispatch a fresh `qa-reviewer` (independent of the test-author teammate). Server enforces the independence rule.
- **Never delete the legacy test** until the new test is signed + green. Per §13.4 partial-upgrade preservation.
- **Never skip intent_sources.** The 13th attestation requires the reviewer to compare test-vs-intent. With no intent_sources the attestation is meaningless.

## Return to the router

```json
{
  "test_case_id": "<old_id>",
  "outcome": "success" | "stuck" | "budget_exceeded",
  "new_test_case_id": "<new_id>" | null,
  "tokens_used": <number>,
  "components_authored_count": <number>,
  "components_reused_count": <number>,
  "qa_reviewer_signed": true | false,
  "evidence": {...}
}
```

The router aggregates per-suite + reports to the user.
