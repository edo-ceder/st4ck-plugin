---
name: qa-testing-debug
description: Use this skill when a test or component has FAILED and needs diagnosis + fix. Triggers on phrases like "this test is failing", "debug this test run", "the runner is erroring", "fix this component", "selector is wrong", "block N failed", "test X broke". Reads the execution log, classifies the failure, proposes a scoped fix, and drives the fix loop.
---

# QA Testing — Debug Journey

Diagnose a test failure. Find root cause, propose a minimal fix, drive to green — without expanding scope.

> **2026-05-02 surface notes (Plenty F31/F32/F33 ship):**
> - **First diagnostic call:** `mcp__st4ck-qa__get_execution_log(execution_id, failed_only: true, drop_aborted_network: true, max_console_entries_per_block: 20)` — slim mode returns ONLY the first failed block + preceding passed block (auto-capped at 5 entries).
> - `error.class: "check_failed"` with `error.detail` starting `"nf:"` is the F33 contract (alpha.13+) — component's evaluate asserted a post-condition and the assertion failed. Full nf: string is in `error.detail`. NOT a runner bug.
> - Sign-gate "expected status=passed" failures: if non-critical block failed/skipped but every critical passed, the gate accepts `status="failed"` on the criticals-only path. KB `1dc73359`.

## Phase 5 error class taxonomy

Routes diagnosis per `error.class` in the structured_log:

| error.class | Likely root cause | First diagnostic |
|---|---|---|
| `element_not_found` | Selector drift (testid renamed, role+name changed) | `snapshot()` vs component's `selector_notes.snapshot_excerpt` |
| `element_ambiguous` | Multiple matches; needs scope | Stricter scope (`scope: 'dialog'` / `by_testid(...)`) |
| `element_not_actionable` | Exists but blocked (covered/disabled/hidden) | Check modal overlay / loading spinner / `pointer-events:none`. Add `wait_until`. |
| `timeout` | Exceeded timeout without actionability error | Raise `opts.timeout_ms`, add prior `wait_until`, inspect network |
| `check_failed` | `session.check` verdict='fail' | Read `actionable_hint` in result |
| `check_protocol_error` / `see_protocol_error` / `extract_protocol_error` | IPC broke (stdin closed, malformed JSON, wrong response type) | Parent died or sent malformed; not a test issue |
| `extract_validation_failed` | Agent returned data, zod rejected | Sharper hint, schema too strict, or page lacks data (real failure) |
| `do_replay_failed` | Cached component primitive failed on replay | Tier-1 couldn't rescue; force re-record (delete component md) |
| `do_no_recording` | `do_complete` with zero primitives | Misunderstood instruction or page already in target state |
| `pause_aborted` | Agent aborted ad-hoc pause | Read abort reason; product issue → `dev_task(source_type='regression_failure', assigned_team='engineering')` |
| `recall_miss` | `session.recall` hit key with no prior remember | Producing block didn't run, or key typo |
| `primitive_not_implemented` | Action shape unrecognized | Check JSON shape against PrimitiveAction / ComponentAction / LegacyAction |

Tier-1 ladder rescue → runner emits `self_heal_event`; backend creates `self_heal_review` dev_task per §5.5. **DO NOT fix the component reactively** — wait for QA triage.

## Common prelude

QA rules live on the server in `methodology.ts`. DO NOT repeat rule text here — load via `get_qa_methodology(section)`. Fetch only when needed: KB search is the first move.

## Your journey

### Step 1 — Start with the KB (NOT methodology)

Pattern-match against what already broke:

```
search_test_knowledge(platform: "<platform>", query: "<failure keywords>")
```

If a matching entry exists: APPLY IT. Cite the entry ID. Don't re-derive. If nothing matches → proceed; at end SAVE the new lesson via `save_test_knowledge`.

### Step 2 — Read the execution log

```
get_execution_log(execution_id)        # full structured log
get_execution_status(execution_id)     # parsed summary
get_test_details(test_case_id)         # current test body
```

Identify: failed block/action, `error.class` + `error.detail`, DOM snapshot at failure, earlier silent seed failures.

### Step 3 — Classify the failure

| Pattern | Root cause | Fix lane |
|---|---|---|
| Selector found zero | Element renamed / class changed / Radix portal | Component `eval_sequence` — regrep, update, re-save |
| Selector found multiple | Bare-tag selector | SELECTOR QUALITY — class-qualified or text-primitive |
| Element has no ARIA role (Radix card, `asChild`) | Non-semantic DOM | `click_by_text` / `hover_by_text` / `type_by_text` with `scope: "dialog"` |
| Seed block failed silently | Data setup broken | Seed → verify seed → assert; add explicit verify block |
| Assertion passed on broken feature | Vague assertion | Specific text/count/amount — methodology `data_setup` |
| Profile locked / credentials wrong | Profile pool | `properties` filter on acquire, or force-release stale lock |
| Component params don't match schema | Drift after `save_component` change | Update test block params; `params_schema` is authoritative |
| Agentic block where deterministic needed | Component missing | Create component, convert the block |

Unclear → `get_qa_methodology(section: "decisions")` for the failure-pattern reference.

### Step 4 — Reproduce locally

**NEVER fix a failure you haven't reproduced** — wrong-root-cause fix passes this run, fails the next.

1. Fixture/session URL from log.
2. `npx st4ck@latest browse launch <url> --session debug-<slug>`.
3. Drive IPC primitives matching the failing eval — one Bash call each. NEVER spawn the runner manually, never `mkfifo`, never echo into a FIFO.
4. Inspect snapshot — confirm diagnosis.

### Step 5 — Propose the minimal fix

Present a `## Failure diagnosis` block (test id+name, block/action, root cause, evidence excerpt + DOM snapshot + source grep, KB reference) followed by a `## Proposed fix` block (target component or test block, specific minimal change, what you're NOT touching and why, risk to other tests using the same component). **STOP. Wait for user approval before modifying anything.**

### Step 6 — Execute the fix

- **Component fix:** `save_component` with new `eval_sequence` / `post_verify` / `selector_notes`. Update TRIAD if selectors changed (new file:line + snapshot excerpt + KB cite).
- **Test block fix:** `modify_test_case` with new blocks. Server clears signatures — needs re-review.

After fix, re-run via `/st4ck:st4ck-run` or `/st4ck:regression-run`. Verify green.

### Step 7 — Re-sign (if needed)

- Component fix → `review_component` + `sign_component_review`. Test `journey_signature` preserved (narrow cascade).
- Test block fix → dispatch fresh `qa-reviewer`. Re-sign.

### Step 8 — Save the lesson

Non-obvious fix → `save_test_knowledge(platform, title, problem, solution, applies_when, confidence, times_resolved: 1)`. This is what makes Step 1 work for the next debugger.

### Step 9 — Report

`## Debug complete: [test name]` — one-sentence failure, fix + why, tests affected (N using same component, re-run status), KB entry ID (saved or cited existing).

---

## Anti-patterns

- **DON'T scope-creep.** Broken selector = selector fix, not whole-component rewrite.
- **DON'T over-loosen selectors.** `querySelector('button')` passes the broken test AND every other test on the page.
- **DON'T re-author.** Whole-test redesign = `qa-testing-regression` or `-version`, not debug.
- **DON'T trust vague log messages.** "Element not found" often hides a timing issue — check prior async work.

---

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
