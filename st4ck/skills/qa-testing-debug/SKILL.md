---
name: qa-testing-debug
description: Use this skill when a test or component has FAILED and needs diagnosis + fix. Triggers on phrases like "this test is failing", "debug this test run", "the runner is erroring", "fix this component", "selector is wrong", "block N failed", "test X broke". Reads the execution log, classifies the failure, proposes a scoped fix, and drives the fix loop.
---

# QA Testing — Debug Journey

You are diagnosing a test failure. A test run has failed; your job is to find the root cause, propose a minimal fix, and drive the fix to green — without expanding scope.

## Phase 5 error class taxonomy

The runner's structured_log carries an `error.class` per failed primitive (per `backend/src/mcp/v3/methodology.ts` § block_format) plus the new Phase 3.x IPC primitives. Use the class to route diagnosis:

| error.class | Likely root cause | First diagnostic |
|---|---|---|
| `element_not_found` | Selector drift (testid renamed, role+name changed) | `session.snapshot()` against the current page; compare to component's `selector_notes.snapshot_excerpt` |
| `element_ambiguous` | Multiple matches; needs scope | Re-resolve with stricter scope (`scope: 'dialog'` or `scope: by_testid(...)`) |
| `element_not_actionable` | Element exists but blocked (covered, disabled, hidden) | Check for modal overlay, loading spinner, `pointer-events:none`. Add `wait_until` before action. |
| `timeout` | Operation exceeded timeout without actionability error | Raise `opts.timeout_ms`, add prior `wait_until` for the precondition, inspect network |
| `check_failed` | Agent returned verdict='fail' on `session.check` | Read agent's `actionable_hint` in the result; usually points at a fix |
| `check_protocol_error` / `see_protocol_error` / `extract_protocol_error` | IPC broke (stdin closed, malformed JSON, wrong response type) | Parent agent died or sent malformed response; not a test issue |
| `extract_validation_failed` | Agent returned data but zod rejected it | Either agent misread page (sharper hint), schema too strict (relax), or page lacks data (real test failure) |
| `do_replay_failed` | Cached component primitive failed during replay | Tier-1 ladder couldn't rescue; need fresh authoring (delete component md to force re-record) |
| `do_no_recording` | Agent sent do_complete with zero primitives | Either misunderstood instruction or page already in target state |
| `pause_aborted` | Agent aborted ad-hoc pause | Read abort reason; if real product issue, file `dev_task(source_type='regression_failure', assigned_team='engineering')` |
| `recall_miss` | session.recall hit a key with no prior remember | Producing block didn't run, or key typo |
| `primitive_not_implemented` | Action shape unrecognized | Check action JSON shape against PrimitiveAction / ComponentAction / LegacyAction |

When the failure is a Tier-1 ladder rescue (component self-healed mid-run), the runner emits a `self_heal_event`; backend creates a `self_heal_review` dev_task per §5.5. Don't fix the component reactively — wait for QA triage.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load via `get_qa_methodology(section)`.
- Fetch methodology only when you need it: KB search is the first move, not a rule lookup.

## Your journey

### Step 1 — Start with the KB (not the methodology)

Failure diagnosis is pattern-matching against what has already broken before. Run:

```
search_test_knowledge(platform: "<platform>", query: "<failure keywords>")
```

Use the failure keyword (e.g., "popover click intercepted", "element not found", "radix portal") — the KB has cross-project solved problems with scored confidence.

If a matching KB entry exists: APPLY IT. Don't re-derive. Cite the entry ID in the fix.

If nothing matches → proceed to step 2, and at the end SAVE the new lesson via `save_test_knowledge` so the next debugger finds it.

### Step 2 — Read the execution log

Get the test run context:

```
get_execution_log(execution_id)        # full structured log
get_execution_status(execution_id)     # parsed summary
get_test_details(test_case_id)         # current test body
```

From the log, identify:
- Which block / action failed
- The agent-browser error or assertion failure text
- DOM snapshot at failure time (if captured)
- Whether any earlier block had seed failures (silent failures cascade)

### Step 3 — Classify the failure

| Pattern | Root cause | Fix lane |
|---|---|---|
| Selector found zero elements | Element renamed / class changed / Radix portal | Component `eval_sequence` — regrep source, update selector, re-save |
| Selector found multiple elements | Bare-tag selector | SELECTOR QUALITY violation — use class-qualified or text-primitive |
| Element has no ARIA role (Radix card, `asChild` wrap) | Non-semantic DOM | Use `click_by_text` / `hover_by_text` / `type_by_text` with `scope: "dialog"` |
| Seed block failed silently | Data setup broken | Seed → verify seed → assert pattern; add explicit verify block |
| Assertion passed on broken feature | Vague assertion | Replace with specific text/count/amount — methodology `data_setup` section |
| Profile locked / credentials wrong | Profile pool issue | `properties` filter on acquire, or force-release stale lock |
| Component params don't match schema | Drift after `save_component` schema change | Update test block params; component's `params_schema` is authoritative |
| Agentic block where deterministic was needed | Component missing | Create the component, convert the block |

If classification is unclear → fetch `get_qa_methodology(section: "decisions")` for the failure-pattern reference list.

### Step 4 — Reproduce the failure locally

Before fixing, reproduce with agent-browser:

1. Get the fixture page / session URL from the log.
2. Run the exact eval step that failed.
3. Inspect the DOM snapshot — confirm your diagnosis.

**Never fix a failure you haven't reproduced.** A fix for the wrong root cause will pass this run and fail the next.

### Step 5 — Propose the minimal fix

Present to the user:

```
## Failure diagnosis

- **Test:** [id + name]
- **Block / action:** [block N, action M]
- **Root cause:** [one sentence]
- **Evidence:** [log excerpt + DOM snapshot + source grep]
- **KB reference:** [entry ID or "searched — no match"]

## Proposed fix

- **Target:** [component X method Y OR test block N]
- **Change:** [specific, minimal]
- **Why minimal:** [what I'm NOT touching and why]
- **Risk:** [any other tests that use this component — will they break?]

Proceed?
```

**STOP. Wait for user approval before modifying anything.**

### Step 6 — Execute the fix

Depending on target:

- **Component fix:** `save_component` with new `eval_sequence` / `post_verify` / `selector_notes`. Update the triad if selectors changed (new file:line + new snapshot excerpt + KB cite).
- **Test block fix:** `modify_test_case` with new blocks. Server clears signatures — test needs re-review.

After fix, trigger a re-run — `/st4ck:st4ck-run` or `/st4ck:regression-run`. Verify green.

### Step 7 — Re-sign (if needed)

- Component fix → `review_component` + `sign_component_review`. Test `journey_signature` is preserved (seal cascade is deliberately narrow).
- Test block fix → dispatch `qa-reviewer` via `qa-reviewer dispatch contract` below. Fresh instance. Re-sign.

### Step 8 — Save the lesson

If you invented or discovered a non-obvious fix, save it:

```
save_test_knowledge(platform, title, problem, solution, applies_when, confidence, times_resolved: 1)
```

This is what makes step 1 (KB first) work for the next debugger.

### Step 9 — Report

```
## Debug complete: [test name]

- **Failure:** [one sentence]
- **Fix:** [what changed + why]
- **Tests affected:** [this test passed; other tests using the same component: N, re-run status]
- **KB entry:** [saved ID if new lesson, else cited existing ID]
```

---

## Anti-patterns

- **Don't scope-creep.** A broken selector is a selector fix, not an excuse to rewrite the whole component. If you want to refactor, propose it as a separate change after the fix is green.
- **Don't over-loosen selectors.** `querySelector('button')` will pass the broken test AND every other test on the same page. Specific selectors or text primitives only.
- **Don't re-author.** If the whole test needs redesign, that's `qa-testing-regression` or `qa-testing-version`, not debug.
- **Don't trust vague log messages.** "Element not found" often hides a timing issue — check if a prior block's async work completed.

---

## Dispatch contracts (for re-review after test-block fixes)

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
