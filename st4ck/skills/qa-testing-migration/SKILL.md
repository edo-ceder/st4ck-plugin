---
name: qa-testing-migration
description: Migrate legacy tests to the v2 component format. Triggers on "migrate these tests", "convert to component format", "modernize tests", "upgrade components". Classifies each test's shape via classify_test_migration_shape, then runs the appropriate internal branch (agentic re-author OR component-upgrade) inline. Per-component escalation between branches handled inline. Per plan §13.2 (consolidated 2026-04-26 — was three skills before).
---

# QA Testing — Migration

**You — the current session agent — are the authoring lead.** Read the lead role-doc below; that's your orchestration playbook. Migration is just a different intent for the same orchestration shape — drive the candidate-component discovery, dispatch `qa-author` teammates, sweep promotions, sign, run.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

This skill replaces three earlier skills (router + Path A + Path B); collapsed 2026-04-26 because every dispatch boundary is a place agents lose context.

## Two internal branches

Migration is a single decision tree. Per test, you classify the shape and run the right branch inline.

| Shape | Branch | Cost target | What happens |
|---|---|---|---|
| **agentic** | Agentic re-author | ~10k tokens/test | qa-author drives the journey from scratch using primitives; saves new components + new test_case; old test atomically swapped at the end |
| **components_v1** | Component upgrade | ~2k tokens/component | mechanical `eval_sequence`→`sequence` translation via `primitive_registry`; fresh snapshot per component; targeted citation gathering; test_case `scenario_blocks` usually unchanged |
| **components_v2** | Skip | 0 | already migrated; defensive case |
| **mixed** | Agentic re-author | ~10k tokens/test | LLM has to disentangle; treat as agentic |
| **empty** | Skip | 0 | flag the test as broken |

**Per-component escalation between branches.** During the component-upgrade branch, individual components can hit cases the mechanical translator can't handle (exotic eval, persisted snapshot ref, unreachable component, TRIAD-rejection). Those components escalate to the agentic re-author flow inline — only that component re-authors, the rest of the test's components keep their mechanical path. Recovery is per-component, not per-test.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "process")`** — orchestration rules.
2. **`get_qa_methodology(section: "component_authoring")`** — the canonical 5-rule + drive-and-decompose workflow + TRIAD + size envelope. Both branches need this.
3. **Classify the scope.** `classify_test_migration_shape({suite_id})` (or `{test_id}` for a single test, or `{scope: "project"}` for the whole project). Returns per-test shape + aggregate counts + estimated token budget.
4. **Probe Agent Teams availability** (per the lead role-doc). Pick mode for the WHOLE migration — Team or sub-agent.
5. **Show the user the classification + budget** — *"Suite has X agentic, Y components_v1, Z components_v2, W mixed, V empty. Estimated budget: ~$N. Proceed?"* — wait for human approval before fanning out.

## Step 5.5 — Optional pre-seed (when N>20 legacy tests)

If the project has many legacy tests AND the candidate-component list (from `get_component_discovery`) shows clear repeated patterns: dispatch a small batch of `qa-author` teammates with a **library-only brief** (drive the candidate flows, save_component, no test composition). The library is then warm before per-test migration runs — speeds up both branches.

This used to be a separate `/st4ck:bootstrap-components` skill; folded in here 2026-04-26 because "how to author a component" is one methodology section anyone can pull on demand, and pre-seeding is just a different invocation context for `qa-author`.

## Step 5.6 — Mandatory bootstrap when project has zero v2 components (Phase 6.1)

Before dispatching ANY per-test migration, check whether the project has at least one signed v2 component to anchor agent dispatches against. Without a reference, every dispatched `qa-author` invents its own conventions — particularly costly on no-code platforms (Bubble, Retool) where idiomatic patterns aren't obvious from the page DOM.

**Detection:** call `get_components({summary: true})`. Count entries where `signed === true` AND the component is v2 (`step_count > 0` indicates `sequence` is populated). If that count is 0, the project is in **fresh-project state**.

**Action when fresh-project state is detected:**

1. **Pick the simplest non-trivial flow** — typically project login. If login is trivial (one click, no MFA), pick the next simplest flow with a verifiable post-state (e.g., dashboard load + visible identity element, settings open, profile name read).
2. **Dispatch one `qa-author` teammate** with a *bootstrap brief*:
   - "Author ONE component for `<flow_name>`. This is the project's reference idiom — every subsequent migration agent will be pointed at it. Be conservative on selectors, exhaustive on TRIAD evidence, and stop after one component is saved."
   - For closed-loop platforms (Bubble/Retool/Webflow/n8n/etc.), instruct the author to set `platform_native: true` + populate `platform_artifacts` ({platform, editor_url, element_id, screenshot_path}) on `save_component` instead of attempting file:line citations.
   - Pass the canonical primitive list (run `st4ck-runner --list-primitives` or fetch via `get_qa_methodology(section: "component_authoring")`).
3. **Dispatch a fresh `qa-reviewer`** with a bootstrap-review brief: "Sign or fail this single component. It will be the project's canonical reference; reviewer rigor must hold."
4. **On approval** — capture the component UUID. Inject into every subsequent dispatch brief:
   - Append: "**Reference idiom for this project:** `<component_name>.<method>` (UUID `<id>`). Match its conventions for locator shape, TRIAD shape, parameter naming, and platform_native handling. Deviate only with stated rationale."
5. **On rejection** — surface the reviewer's findings to the user; do NOT proceed with per-test migration. The first component must be signed before the orchestrator dispatches the wider sweep.

**Why this is mandatory, not optional:** without a reference, the first 3-5 migrated components produce inconsistent conventions; later components inherit drift; reviewer load triples chasing inconsistencies. One signed reference upfront amortizes across the whole sweep.

**When to skip:** project already has ≥1 signed v2 component (`get_components` returned a non-zero count with `signed === true && step_count > 0`).

## Branch A — Agentic re-author (Shape-A or mixed)

Same orchestration shape as `/st4ck:regression-author`:

1. **Derive `intent_sources`** — read test metadata (name, description, suite), linked PRD nodes / specs / dev_tasks if present, else populate `{source_type:'free_text', source_text: <inferred from description + action list>}`.
2. **Component discovery (if not already done in Step 5.5).** `get_component_discovery({intent_sources, module})`.
3. **Pre-acquire profile + capture storageState** for the batch.
4. **Dispatch one `qa-author`** per legacy test (parallel via multiple `Agent` calls; up to 5 concurrent). Pass each: the legacy test's full `scenario_blocks` (verbatim, as the journey description), `intent_sources`, candidate-component list, existing component library, `profile_id` + storageState path.
5. **Verdict recovery** mode-aware (Team mode → SendMessage; sub-agent mode → re-dispatch fresh).
6. **Promotion sweep** across the just-authored test_cases.
7. **Dispatch fresh `qa-reviewer`** per test for sign.
8. **Atomic swap** — for each newly signed test, atomically update the OLD test_case row to use the new `scenario_blocks` + new `journey_signature` + new `linked_execution_id`; clear `legacy_signature` flag. Status stays `signed`. Per §13.4 partial-upgrade preservation: do NOT delete the old test until the new one is signed + has a passing execution.
9. **Dispatch `qa-runner`** for execution against the target environment.

## Branch B — Component upgrade (Shape-B)

This branch is mostly mechanical. You don't always need to dispatch `qa-author` teammates — many steps run inline in your context.

**Per-component work** (runs once per unique component referenced by the test, not once per test):

1. **Idempotency check** — if `component.sequence IS NOT NULL` already, skip (v2 upgrade already done).
2. **Translate `eval_sequence` → `sequence`** via `primitive_registry` lookup:
   - For each step in `eval_sequence`, look up its action verb in `primitive_registry` (either `current_name` or `deprecated_names`) → get the stable `primitive_code`.
   - Emit `{primitive_code: "p.X", ...rest_of_step}`. Preserve locator shape (by/value/scope).
   - If a step has no primitive-code equivalent: **escalate this component to Branch A** (full re-author). Record reason. Continue with the rest of the test's components.
3. **Server-side ref-rejection check** — scan emitted `sequence` for any `ref: "eN"` fields. If any → **escalate this component to Branch A** (v1 component persisted a snapshot ref; needs re-snapshot via fresh drive).
4. **Capture fresh `snapshot_excerpt`** — spin up `st4ck-runner record` against the component's target URL (recovered from `recording_metadata` if present; else from test's first block), take a snapshot. If component can't be reached in isolation → **escalate to Branch A**.
5. **Gather `source_citations`** — for each `selector_notes.legacy_text` mention of a file path, read the cited file at current `git_sha` and produce a structured `{path, line, git_sha, note}` entry. If legacy_text doesn't cite paths (most v1 components don't), dispatch a small `qa-author` teammate with a "citation-gathering brief" (read source + KB search; no driving). ~1-2 LLM calls per component.
6. **Search `automation_lessons`** — `search_test_knowledge({query: <component-name> + <app-framework>})`. Attach hit IDs to `kb_entries`. If no hits, set sentinel `["searched, nothing matched"]`.
7. **Save as v+1** — `save_component` with `sequence`, full TRIAD, `recording_metadata.recorded_via='v1_upgrade'`, mark old v as `deprecated_versions`.
8. **Server-side TRIAD validation** fires at save. If rejected → escalate THAT component to Branch A; rest can still upgrade mechanically.

**Per-test work** (after all referenced components upgraded):

1. **`scenario_blocks` change required?** — usually NO. Block shape `{component, method, params}` doesn't change; only the underlying component's storage format did. If any block had an inline action that gets promoted to a component during upgrade (rare), update that block.
2. **Derive + attach `intent_sources`** — same logic as Branch A step 1.
3. **Dispatch `qa-runner`** for smoke run + determinism check.
4. **Dispatch fresh `qa-reviewer`** for 13-item attestation sign.
5. **Atomic promote.**

## Order

Run Branch A and Branch B in parallel where the classification has both shapes — they don't share state. Within each branch, tests run in parallel up to the concurrency budget (5 default, 8 with `ST4CK_MAX_CONTEXTS_PER_DAEMON=8`).

## Don't

- **Don't skip the classification.** The whole point of branching is matching cost to shape.
- **Don't override the human gate.** Show the user the budget; wait for approval.
- **Don't fold both branches into a single qa-author dispatch.** Branch B's mechanical translation is much cheaper than re-authoring; Branch A on Shape-B duplicates work the legacy author already did.
- **Don't run Branch A on a Shape-B test "because it's safer."** It's not safer — it's more expensive and more brittle.
- **Don't delete the legacy test** until the new test is signed + green. Per §13.4 partial-upgrade preservation.

## Return to the user

A summary table:

```
Migration: <suite-name or scope>
  Branch A re-authors: M signed / N total
  Branch B upgrades:   K signed / L total
  Component escalations B → A: D
  Skipped (already v2):  S
  Skipped (empty):       E
  Estimated total spend: $X
  Actual spend:          $Y
```

Plus: per-test verdict with link to the test in the st4ck UI.

---

## Dispatch contracts

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
