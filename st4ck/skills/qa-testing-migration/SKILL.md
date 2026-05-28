---
name: qa-testing-migration
description: Migrate legacy tests to the v2 component format. Triggers on "migrate these tests", "convert to component format", "modernize tests", "upgrade components". Classifies each test's shape via classify_test_migration_shape, then runs the appropriate internal branch (agentic re-author OR component-upgrade) inline. Per-component escalation between branches handled inline. Per plan §13.2 (consolidated 2026-04-26 — was three skills before).
---

# QA Testing — Migration

**You — the current session agent — are the authoring lead.** Replaces three earlier skills (router + Path A + Path B); collapsed 2026-04-26 — every dispatch boundary loses context.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

> **2026-05-02 surface notes (Plenty ship):** `save_and_sign(..., linked_execution_id)` — composed verb; ~2× faster, idempotent on `(content_hash, linked_execution_id, signed)`. `validate_component(...)` — dry-run lint without writing. **OK/NF contract server-enforced** — `evaluate` returning `"nf:..."` fails with `error.class="check_failed"` (alpha.13+); assert `return <verified> ? 'ok: <state proof>' : 'nf: <reason>'`. KB `9430ae8a` + `04e3cc28`. `wait_until kind: "js"` aliases `"custom"` (alpha.12+). Sign-gate tolerates non-critical block failures — accepts `exec.status === "failed"` when every critical + exercising block passed. KB `1dc73359`. Slim responses on save/review/sign — use `get_component(name, method)` for full payload.

## Two internal branches

| Shape | Branch | Cost | What happens |
|---|---|---|---|
| **agentic** | A — re-author | ~10k/test | qa-author drives from scratch; saves new components + new test_case; atomic swap |
| **components_v1** (clean code-backed) | B — component upgrade | ~2k/component | mechanical `eval_sequence`→`sequence` via `primitive_registry`; fresh snapshot; `scenario_blocks` usually unchanged |
| **components_v1** (`likely_demotes_to_path_a: true`) | A | ~10k/test | classifier surfaced `path_b_blockers[]`; mechanical translation would lose them |
| **components_v1** (closed-loop: Bubble/Retool/Webflow/n8n) | A | ~10k/test | **Blanket A.** Closed-loop needs fresh drives to capture `platform_artifacts`; B has no browser session |
| **components_v2** | Skip | 0 | already migrated |
| **mixed** | A | ~10k/test | LLM disentangles |
| **empty** | Skip | 0 | flag broken |

**Path-B-blocker pre-routing (§6.0).** `classify_test_migration_shape` returns `path_b_blockers: string[]` + `likely_demotes_to_path_a: boolean`. Route `components_v1` with `likely_demotes_to_path_a === true` to A immediately. Surface `path_b_blockers[]` in budget approval.

**Per-component escalation.** Within `components_v1`, individual components hitting cases B can't handle (exotic eval, persisted snapshot ref, unreachable, TRIAD-rejection) escalate to A inline — only that component re-authors.

## First actions — MANDATORY in order

1. `get_qa_methodology(section: "process")` — orchestration rules.
2. `get_qa_methodology(section: "component_authoring")` — 5-rule + drive-and-decompose + TRIAD + size envelope.
3. `classify_test_migration_shape({suite_id})` (or `{test_id}` / `{scope: "project"}`).
4. Probe Agent Teams (per lead role-doc). Pick mode for the WHOLE migration.
5. **Show user classification + budget; WAIT for approval.**

## Step 5.5 — Optional pre-seed (N > 20 legacy tests)

If many legacy AND `get_component_discovery` shows repeated patterns: dispatch a small `qa-author` batch with a **library-only brief** (drive candidates, `save_component`, no test composition). **Precedence:** if §5.6 applies, run §5.6 FIRST and SKIP §5.5.

## Step 5.6 — MANDATORY bootstrap when project has zero v2 components (§6.1)

Before dispatching ANY per-test migration, ensure ≥1 signed v2 component anchors agent dispatches. Without a reference, each `qa-author` invents conventions — especially costly on no-code.

**Detection:** `get_components({summary: true})` → read `summary_meta.is_fresh_project: boolean` directly. **DO NOT re-derive from `step_count`** (kept for back-compat as v1 `eval_sequence` length — non-zero on every legacy component, would falsely suggest v2 coverage).

**When fresh-project:**

1. Pick simplest non-trivial flow (typically login, or next-simplest with verifiable post-state).
2. Dispatch one `qa-author` with bootstrap brief: "Author ONE component for `<flow_name>`. Project reference idiom. Conservative selectors, exhaustive TRIAD, stop after one." For closed-loop, instruct `platform_native: true` + populate `platform_artifacts`.
3. Dispatch fresh `qa-reviewer` with bootstrap-review brief.
4. **On approval** — capture UUID. Inject into every subsequent dispatch: "**Reference idiom for this project:** `<name>.<method>` (UUID `<id>`). Match locator shape, TRIAD shape, parameter naming, platform_native handling. Deviate only with rationale."
5. **On rejection** — surface to user; do NOT proceed.

**Platform-native attestation.** Closed-loop bootstrap reviewer MUST include one of `editor_url_inspected`, `screenshot_verified`, `element_id_matched`, `platform_artifacts_reviewed` in `checked_items`, OR a `notes` field quoting the literal `editor_url`. Generic notes rejected per §6.1.

## Branch A — Agentic re-author

1. Derive `intent_sources` — test metadata + linked PRD/spec/dev_task; else `{source_type:'free_text', source_text: <inferred>}`.
2. Component discovery (if not done §5.5): `get_component_discovery({intent_sources, module})`.
3. Pre-acquire profile + storageState for the batch.
3a. **Pre-fetch project context for the dispatch brief** (Ori e757fc2f, 2026-05-14). Call ONCE, inject into every qa-author: `get_qa_methodology(section: "component_authoring")` → key + expires_at; `get_test_environments()` → qa_notes; `get_components({summary: true})` → slim catalog. Re-fetching at startup over-bills by ~50KB per spawn.
4. Dispatch one `qa-author` per legacy test (parallel; up to 5). Pass each: legacy `scenario_blocks` verbatim, `intent_sources`, candidate list, library, `profile_id` + storageState, pre-fetched context.
5. Verdict recovery mode-aware (Team → `SendMessage`; sub-agent → re-dispatch fresh).
6. Promotion sweep across just-authored test_cases.
7. Dispatch fresh `qa-reviewer` per test.
8. **Atomic swap** — update OLD test_case row to new `scenario_blocks` + new `journey_signature` + new `linked_execution_id`; clear `legacy_signature`. Status stays `signed`. Per §13.4: **DO NOT delete old until new is signed AND has a passing execution.**
9. Dispatch `qa-runner` against target environment.

## Branch B — Component upgrade

Mostly mechanical; many steps run inline.

**Per-component** (once per unique component):

1. Idempotency: `component.sequence IS NOT NULL` → skip.
2. Translate `eval_sequence` → `sequence` via `primitive_registry` (lookup `current_name` or `deprecated_names` → stable `primitive_code`). Emit `{primitive_code: "p.X", ...rest}`. Preserve locator. No equivalent → **escalate to A**.
3. Ref-rejection: scan `sequence` for `ref: "eN"` → **escalate to A** (needs re-snapshot).
4. Capture fresh `snapshot_excerpt` — `browse launch <url>` → `browse snapshot` → `browse close`. Unreachable in isolation → **escalate to A**.
5. `source_citations` — read each `legacy_text` file path at current `git_sha` → `{path, line, git_sha, note}`. No paths cited → dispatch small `qa-author` with "citation-gathering brief" (~1–2 LLM calls).
6. `search_test_knowledge({query: <name> + <app-framework>})` → attach hit IDs to `kb_entries`. No hits → sentinel `["searched, nothing matched"]`.
7. Save as v+1 — `save_component` with `sequence`, full TRIAD, `recording_metadata.recorded_via='v1_upgrade'`, old version `deprecated_versions`.
8. Server-side TRIAD validation at save. Rejected → escalate THAT component to A.

**Per-test** (after all referenced components upgraded):

1. `scenario_blocks` change? Usually NO. Block shape unchanged; only storage format did.
2. Derive + attach `intent_sources` — same as A.1.
3. `qa-runner` for smoke + determinism.
4. Fresh `qa-reviewer` for 13-item attestation sign.
5. Atomic promote.

## Order

A and B run in parallel where both shapes present. Within each, tests run in parallel up to budget (5 default, 8 with `ST4CK_MAX_CONTEXTS_PER_DAEMON=8`).

## DO NOT

- DO NOT skip classification.
- DO NOT override the human gate.
- DO NOT fold both branches into one dispatch.
- DO NOT run A on a Shape-B test "to be safe" — more expensive AND more brittle.
- DO NOT delete legacy until new is signed + green (§13.4).

## Return

```
Migration: <suite-name or scope>
  Branch A re-authors: M signed / N total
  Branch B upgrades:   K signed / L total
  Component escalations B → A: D
  Skipped v2:S empty:E
  Estimated $X / Actual $Y
```

---

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
