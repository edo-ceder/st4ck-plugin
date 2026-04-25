---
name: qa-testing-upgrade-components-v1-to-v2
description: Path B migration — light, mostly-mechanical upgrade of v1 components (eval_sequence) to v2 (sequence + TRIAD + git-cited citations). Per plan §13.2.B. Triggered by qa-testing-migration router for shape='components_v1'. Budget ~2k tokens/component. Demotes individual components to Path A on exotic eval / persisted ref / unreachable component / TRIAD-rejection.
---

# Path B — Upgrade components_v1 to v2

You upgrade ONE Shape-B test by upgrading its components in place. Light path: mechanical translation of `eval_sequence` to `sequence` via the primitive registry, with bounded LLM use only for citation gathering.

## When this skill is the right path

The router (`qa-testing-migration`) dispatches you for tests classified as **components_v1**: every action is `{component, method}`, the test composes cleanly, but the underlying components store legacy `eval_sequence` instead of v2 `sequence`. The new schema requires `sequence` + git-cited `selector_notes.source_citations` + KB linkage + a fresh snapshot.

You should NOT be invoked for shape='agentic' or 'mixed' — those need the full Agent Teams cycle (Path A).

## Why two cost orders of magnitude

A Shape-B test already has the structural decomposition done — someone authored the components originally. You aren't re-authoring; you're re-formatting what's there. The bulk of the LLM cost comes from gathering source citations + writing a TRIAD-shaped `selector_notes` block. Per component target: ~2k tokens.

If you accidentally trigger Path A's full cycle on a Shape-B test you'd repeat work that's already done — wasted spend.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "block_format")`** — get the block + component rules + the methodology_key.
2. **`get_test_details({test_case_id})`** — read the test. Confirm every action is `{component, method}` shape with no `{action, expected}` mixed in. If you find legacy actions, return `wrong_path` to the router.
3. **List the components used:** scan the scenario_blocks → set of `(component_name, method)` pairs. These are your scope.

## Per-component workflow

For each `(name, method)` in scope:

### Step 1 — Read the legacy component

`get_component({name, method})` — returns the v1 row including `eval_sequence` + `params_schema` + any existing `selector_notes` (probably free-text or `{legacy_text: ...}`).

If `sequence` is already populated AND `selector_notes` carries a structured TRIAD block — already v2; skip with verdict `already_v2`.

### Step 2 — Translate eval_sequence → sequence via the primitive registry

The primitive registry maps eval-step shapes to typed primitive codes (`p.click`, `p.fill`, etc., plus `params` schemas). For each eval step:
- Look up the matching primitive code by op/intent
- Translate args (DOM selectors, values) into the primitive's typed shape
- Append to the new `sequence` array

If the eval step doesn't map cleanly to a primitive (exotic JS, custom DOM walks, dynamic selectors that resist typing) — **demote this component to Path A**. Return `demote_to_path_a` for this test (one bad component is enough to halt mechanical upgrade for this test). Don't try to be clever; demotion is cheaper than getting it wrong.

### Step 3 — Capture a fresh snapshot

Spin up the runner against the project's staging environment. Acquire the test profile. Navigate to where the component runs. Capture `ariaSnapshot` of the relevant subtree.

This becomes the `selector_notes.snapshot_excerpt`. If the runner can't navigate (auth issue, missing data) — `demote_to_path_a` (the full Agent Teams flow handles auth + data setup natively).

### Step 4 — Gather source citations (bounded LLM)

For every selector in the new `sequence`:
- Grep the project repo for the selector value (testid, role+name, label, etc.)
- For each hit, record `{path, line, git_sha?}` in `source_citations`
- If a selector matches zero source files — **demote_to_path_a** (citation must exist; Path A will live-author against the actual UI).

This is the only LLM-bounded step. Keep prompts tight: pass the selector + grep results, ask the model to pick the canonical citation. Do NOT let the LLM expand into general authoring — if it tries, halt and demote.

### Step 5 — Search the KB

`search_test_knowledge({platform, query: <component-target-feature>})` — pull any prior lessons relevant to this component's UI element family. Each hit links into `selector_notes.kb_entries`.

### Step 6 — Save the v2 component

`save_component({name, method, sequence, params_schema, selector_notes: {source_citations, snapshot_excerpt, kb_entries}, platform})`. The server enforces TRIAD presence; if it rejects with TRIAD violation despite your inputs, demote that component to Path A (something about its shape isn't compatible with mechanical upgrade).

### Step 7 — Self-test

Run the OLD test (which still uses the same component name+method) on staging. If green — the upgrade is transparent (component contract preserved). If red — demote_to_path_a (something about the upgrade broke the test; Path A will re-author end-to-end).

## After all components in scope are upgraded

If every component upgraded cleanly:
- The test itself didn't change (its blocks still reference the same component names/methods).
- Run the test once more to confirm green.
- Update the test record's `intent_sources` (use the most-likely-correct entries: prd_node / spec_section / dev_task / free_text — for Shape-B, free_text from the test's existing description is usually the right minimum).
- Dispatch qa-reviewer for the existing-test revalidation pass.
- Return verdict `success` to the router.

If any component triggered `demote_to_path_a`:
- Return verdict `demote_to_path_a` to the router with the failed component IDs.
- Do NOT modify the test record's blocks (preserve the component-format references). Path A re-authoring will swap in re-authored components when it runs.
- Path A will pick up where you left off — partially-upgraded components stay; demoted ones get re-authored.

## Demotion preserves partial upgrade (per §13.4)

When you demote a test because of one bad component, all OTHER components you successfully upgraded in Step 6 are saved (the v2 row is committed in the DB). Path A's component-author teammate will see them as already-v2 in `get_components` and skip them. Net result: Path B did 80% of the work; Path A handles the 20% it couldn't.

## Hard rules

- **Never call session.do or any LLM-driven authoring primitive.** That's Path A. You translate + cite + verify; you don't author.
- **Never modify the test's scenario_blocks.** The component names/methods stay; only their internals upgrade. If a block needs changing, demote.
- **Demote on uncertainty.** Path A is more expensive but always correct. Path B is cheaper but fragile. When unsure, demote.
- **Citation count > 0 per selector.** A selector with zero source citations is a stale reference; demote.

## Return to the router

```json
{
  "test_case_id": "<id>",
  "outcome": "success" | "demote_to_path_a" | "stuck" | "already_v2",
  "components_upgraded": [{"name": "...", "method": "..."}],
  "components_demoted": [{"name": "...", "method": "...", "reason": "exotic_eval | unreachable_citation | persisted_ref | triad_rejected | self_test_failed"}],
  "tokens_used_total": <number>,
  "evidence": {
    "self_test_execution_id": "<uuid>" | null
  }
}
```

The router aggregates per-suite + reports.
