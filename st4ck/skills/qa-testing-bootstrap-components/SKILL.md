---
name: qa-testing-bootstrap-components
description: Phase 6 §6.2 prerequisite — seed the project's test_components library before per-test migration runs. Calls get_component_discovery to combine four signals (existing tests + dev plan + PRD + codebase scan); the current session agent (acting as the authoring lead) then dispatches `component-author` teammates per candidate. Returns a populated component library. Triggered by `/st4ck:bootstrap-components` or auto by qa-testing-migration router when classifier reports significant uncovered candidate count.
---

# QA Testing — Bootstrap Components

You seed a project's `test_components` library so that per-test migration (Path A and Path B both) has a populated component pool to compose against. This is the §4.1 component-discovery phase shipped as a standalone skill.

## When this skill is the right entry point

- Phase 6 §6.2: before running `/st4ck:migrate-tests` against a fresh project, run this skill to pre-seed components. Path A re-authors benefit from a pre-seeded library; Path B's citation-gathering benefits from having relevant component source paths already grepped + KB-linked.
- New customer onboarding: after `code-to-PRD` lands the project's PRD tree, run this skill to author the most-reused components before authoring tests.
- Coverage-gap closure: when `get_uncovered_intent_sources` reports many uncovered intent nodes, run this skill scoped to those nodes to author components needed to cover them.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "process")`** — orchestration rules.
2. **`get_components()`** — read what's already in the library. Don't author duplicates.
3. **`get_component_discovery({intent_sources?, module?})`** — surface candidates from the four signals (existing components, repeated test actions, PRD user_flow/screen nodes, spec sections). Returns:
   - existing_components: skip these
   - candidates_from_tests: ≥2× repeated free-text actions
   - candidates_from_intent: PRD nodes + spec sections cited by the user

4. **`get_test_profiles()`** — confirm at least 1 profile per role exists. If a role appears in scope but no profile exists, halt and surface to the user — without profiles, component_authors can't acquire one to spin up a live session.

## Per-candidate workflow

For each candidate from `candidates_from_tests` and `candidates_from_intent`:

### Step 1 — Apply the §7.1 5-rule definition

A component is worth authoring if it satisfies ALL five:
1. **Reusable** — appears or will appear in ≥2 tests
2. **Parameterizable** — has clean inputs (params) that change per test
3. **Single user-visible outcome** — one effect, not a multi-step orchestration
4. **Behaviour-focused** — describes WHAT the user does, not HOW the test reaches the right page
5. **Citation-anchored** — has stable selectors that grep the source code

If a candidate fails the 5-rule, drop it (the orchestrator will inline the steps in the test instead).

### Step 2 — Dispatch component-author teammates yourself (you ARE the lead)

You — the current session agent — orchestrate. Per the lead role-doc (`shared/authoring-lead-role.md`), you dispatch `component-author` leaf teammates directly. **No "authoring-lead" sub-agent.** Bootstrap mode is the simplest team shape: just component-authors, no test-author / qa-reviewer / qa-runner needed (no tests to author or run).

For each surviving candidate, dispatch one `component-author` teammate. Run them in parallel via multiple `Agent` tool calls in one message — up to 5 concurrent (8 with `ST4CK_MAX_CONTEXTS_PER_DAEMON=8`). Pass each:

```
{name, method, params_schema, target_ui, source_citations_hint, role, project_id}
```

Per-teammate work (handled inside each component-author):
- KB search (mandatory)
- Source read + handler audit
- Profile acquire → live session → session.do → self-test → KB writeback → release profile

### Step 3 — Collect teammate verdicts into the bootstrap coverage report

As each `component-author` returns its per-candidate verdict, accumulate into:
```json
{
  "mode": "bootstrap",
  "components_authored":  [{ "component_id": "...", "name": "...", "method": "...", "signed": true|false }, ...],
  "components_skipped":   [{ "name": "...", "method": "...", "reason": "already in library" }, ...],
  "stuck_components":     [{ "name": "...", "method": "...", "stuck_kind": "...", "evidence": {...} }, ...],
  "dev_tasks_filed":      [{ "id": "...", "assigned_team": "...", "source_type": "...", "title": "..." }, ...]
}
```

You file the dev_tasks for stuck components per the §5.7 escalation matrix (the leaf component-author teammate doesn't have visibility to the full bootstrap context, so filing happens here at the orchestrator level).

### Step 4 — Continue or halt

- All `components_authored` succeeded → bootstrap complete; run the user-facing summary in "Return to the user" below.
- `stuck_components.length > 0` → file dev_tasks per the §5.7 escalation matrix and surface in the report.
- If `stuck_components.length / (components_authored.length + stuck_components.length) > 0.30` AND the dominant `stuck_kind` is `selector_unresolvable` or `st4ck_primitive_bug`, **halt the bootstrap** and surface to the user — something structural is wrong (UI built differently than expected, or st4ck primitives don't fit this app's patterns).

## Parallelism

Per plan §6 step 4: 5 concurrent component-author teammates by default (configurable to 8 via `ST4CK_MAX_CONTEXTS_PER_DAEMON`). Each runs in its own context window; you (the parent session) manage the queue.

## Stop condition

The bootstrap finishes when:
- Every surviving candidate has been dispatched and resolved (success or stuck).
- OR the user-set component count target is hit.
- OR the budget cap is reached ($N total — ask user upfront).

## Return to the user

```
Bootstrap complete:
  Existing components (preserved): N
  Candidates discovered:           M
  5-rule survivors:                K
  Newly authored:                  J
  Stuck:                           S (dev_tasks queued)
  Total tokens used:               $T
  Library now has:                 N + J components
```

Plus: per-component link to st4ck UI (component detail page).

## Hard rules

- **Never author components in your own context.** Always dispatch `component-author` teammates (one per candidate). Your job is the queue + the dev_task filing, not the authoring.
- **Never lower the 5-rule.** "Almost reusable" tests should NOT become components — they pollute the library and confuse component_author teammates later.
- **Never skip the KB search.** Bootstrap is high-volume; KB hits compound. A single saved lesson can prevent stuck verdicts on 5 subsequent components.
- **Profile per role.** If a role has no profile, halt and ask user — don't author profiles silently.

## When NOT to run

- Project has zero tests AND zero PRD AND zero spec sections. There's nothing to discover from. User should run `/st4ck:po-research` (or equivalent) to seed at least an outline first.
- The classifier reported every existing test is shape v2 (already migrated) AND `get_components` returned a populated library AND `get_uncovered_intent_sources` returned empty. Nothing to do.
