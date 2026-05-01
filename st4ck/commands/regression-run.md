---
description: Execute signed regression test suites and report results with evidence. Observe-only — does not attempt to fix code.
argument-hint: <suite name | suite ID | "all" | "module:ModuleName">
---

# /regression-run

You are a regression test execution orchestrator. You run signed regression suites and report what happened. You do NOT attempt to fix anything — observe and report only.

## Suite Resolution

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| `all` | Get all regression suites via `get_test_suites(category: "regression")` |
| `module:X` | Get regression suites for module X |
| Suite name or UUID | Get that specific suite |
| Nothing | List available regression suites, ask user to pick |

---

## Pre-Flight Check

For each resolved suite:

1. Call `get_suite_health(suite_id)` to check readiness
2. Report:
   ```
   ## Pre-Flight: [Suite Name]
   - Total tests: [N]
   - Ready: [N] (signed, has blocks, profile linked)
   - Not ready: [N]
     - Unsigned: [list] — run /regression-author to fix
     - Missing profile: [list] — link a test profile
     - No blocks: [list] — test has no executable content
   ```

3. If any blockers exist:
   **STOP. Report blockers and recommend action.**
   - "Y tests are unsigned — run `/regression-author` to review and sign them"
   - "Z tests have frontend blocks without role or profile_id — add role to component-format blocks"
   
   NOTE: `get_suite_health` does not report signature status. To check for unsigned tests, call `get_test_details` on each test and check `journey_signature` (component-format) or `review_signature` (legacy). Tests without the appropriate signature cannot be executed by the deterministic runner.

4. If all tests are ready, confirm:
   ```
   Ready to execute [N] tests across [M] suites. Proceed?
   ```
   Wait for confirmation before starting execution.

---

## Execute

For each test in the suite, run the **deterministic runner** via the `st4ck` brand binary (zero LLM cost outside any agentic blocks):

```bash
npx st4ck@latest run <test_case_id> <base_url> \
  --environment <env_id> [--branch <name>] [--git-sha <sha>]
```

`@latest` resolves to the current release at invocation time. Pin to an explicit version (e.g. `npx st4ck@0.2.0-alpha.3`) only when reproducibility matters.

For mobile / locale / timezone-aware regression suites, append browser-context emulation flags (`--device "iPhone 14 Pro"`, `--locale "he-IL"`, `--timezone-id "Asia/Jerusalem"`, `--geolocation "lat,lon"`, etc.) — same surface as `/st4ck:browse`. Full table at [/st4ck:browse](st4ck-browse.md#browser-context-emulation-flags). The escape hatch (`--context-options '<json>'`) reaches Playwright fields not exposed as flags (`recordVideo`, `recordHar`, etc.).

The runner reads `ST4CK_TOKEN` from the environment. Claude Code automatically sets it from the `headers.Authorization` value in `.mcp.json`. Do not pass it inline.

### Execution flow per test

1. Run the runner — handles deterministic blocks + profile acquisition + agentic-block IPC pauses inline.
2. Handle final exit codes:
   - **0**: Test passed — record result, continue to next test.
   - **1**: Test failed — search `search_test_knowledge` with the error pattern before diagnosing from scratch. Record failure with evidence, continue to next test.

There is no exit-on-pause; the runner stays alive for IPC pauses (see below).

### Handling agentic blocks (IPC pause)

**Agentic blocks are a LAST RESORT.** They should only exist when the block requires runtime decision-making (branching on unpredictable state, visual judgment, or dynamic query construction). "Complex UI" is never a valid reason — date pickers, edit dialogs, and Radix dropdowns are all scriptable as components. If you encounter an agentic block that looks scriptable, flag it in the report.

When the runner reaches an agentic block, it stays alive and emits an `agentic_pause` envelope on **stdout** (with a `session_name` field naming the active runner session), then waits for the next IPC command on its stdin. You handle the brief inline using `st4ck browse <op>` invocations against the same `session_name`; when satisfied, send `{"op":"continue"}` to the runner's stdin and the runner resumes at the next block in the same browser context.

For the work itself, drive via the `st4ck browse` CLI — see [/st4ck:browse](st4ck-browse.md) for the full subcommand vocabulary. The CLI handles all IPC plumbing; you make one Bash call per primitive, no `mkfifo`, no FIFO write-ends to manage.

Pause envelope shape:

```json
{
  "type": "agentic_pause",
  "test_case_id": "test-...",
  "execution_id": "exec-...",
  "block_index": 3,
  "session_name": "<runner-session-name>",
  "brief": "Verify today's daily order...",
  "expected_outcome": "Order exists with submitted status and 1+ line items",
  "page_url": "https://...",
  "profile": { "id": "...", "email": "...", "role": "Customer" }
}
```

**Execution steps:**

1. Parse the pause envelope — `brief` is your primary instruction, `expected_outcome` is the verdict criterion. `session_name` names the live runner session; pass it as `--session <name>` (or `-s <name>`) to every `st4ck browse` invocation below. The runner has already acquired any profile required by the block's `role`; you do not call `acquire_profile` again.
2. Execute the brief:
   - **Frontend brief** — drive the same browser context via `st4ck browse <op>` invocations: `npx st4ck@latest browse snapshot --session <name>`, `npx st4ck@latest browse click --session <name> --by role --value button --name "Save"`, etc. Full vocabulary in [/st4ck:browse](st4ck-browse.md). The page state at the pause moment is already loaded.
   - **Backend brief** — call `mcp__st4ck-dev__bubble_list_records` / `mcp__st4ck-dev__supabase_query` to verify data via the project's DB. Backend blocks are SELECT-only by default.
3. **Decide pass/fail.** Write a short verdict + evidence (row count, field values, screenshot path).
4. **Resume the runner.** Send `{"op":"continue"}` to the paused runner's stdin — the runner records the agentic block as passed (using your trace) and proceeds to the next block in the same browser context. No process restart, no `--continue` flag.
5. **If you cannot satisfy the brief.** Send `{"op":"abort","reason":"<short>"}` to the runner's stdin — the runner records the block as failed and exits 1. Don't resume on aborted blocks.

### Suite-level rules:
- Run tests within a suite **sequentially** (one browser session at a time)
- If multiple suites, run suites sequentially
- After each suite completes, write summary to `.st4ck/regression-results-[date].json`
- Discard raw runner output from context (the state file summary is sufficient)

### Safety limits (MUST enforce)

These rules exist so a broken environment, a stale selector, or a single slow model turn can't burn an entire batch without the human noticing. Treat them as hard rules, not suggestions.

1. **Incremental write (heartbeat)**: after every test, append its result to `.st4ck/regression-results-[date].json` **before** any triage reasoning, search_test_knowledge call, or summary text. Ordering: runner exits → write result → then triage. This makes progress externally visible; a silent agent with no file updates is indistinguishable from a hang.

2. **Triage turn budget**: no more than ~90 seconds of reasoning between tests. If a failure needs deeper diagnosis, record a short `triage_notes` field in the result and move on — the human will dig in after the batch.

3. **Consecutive-failure bail**: if **3 tests in a row** fail with the **same error signature** (same missing selector, same runner error string, same MCP error), STOP the batch and return. A repeated signature almost always means an environmental/infrastructure issue, and running the remaining 30+ tests into the same wall wastes wall-clock and pollutes the report.

4. **Per-test retry policy**:
   - Exit 0: record pass, continue.
   - Exit 1: **do not retry**. Record failure with evidence (include `log.console_errors` from the saved execution log — the runner captures browser console on every failure), continue.
   - Agentic pause (in-process): handle the brief inline via stdin and resume with `{"op":"continue"}`. Never retry a pause — either the agentic step passed or it didn't.
   - Bash timeout (600s) OR runner crash before any block started: retry **once**, then skip to next test with `verdict: "infrastructure_error"`. Never retry more than once.

5. **Hard wall-clock cap**: 90 minutes per batch. When hit, stop wherever you are, write the partial report, and return. The human can resume the remaining tests separately.

6. **Progress signal every 5 tests**: emit one line of text (e.g. `Progress: 15/40 — 11 pass, 3 fail, 1 agentic`). Keeps the human informed without verbose per-test output.

Silent long pauses are acceptable when they're a single slow Sonnet inference turn (not a hang), but rules 1, 3, and 5 guarantee the batch can't silently run off the rails for long without a human seeing something.

---

## Report

After all suites have been executed:

```
## Regression Run Report — [Date]

### Summary
| Suite | Tests | Passed | Failed | Flaky | Error |
|-------|-------|--------|--------|-------|-------|
| [name] | [N] | [N] | [N] | [N] | [N] |
| **Total** | **[N]** | **[N]** | **[N]** | **[N]** | **[N]** |

### New Failures (not seen in previous run)
These failures are NEW — they likely indicate a recent regression:

| Test | Suite | Failure | Diagnosis |
|------|-------|---------|-----------|
| [name] | [suite] | [what failed] | [code_bug / test_bug / environment] |

### Known Failures (seen before)
These failures were also present in the last run:

| Test | Suite | Status | Notes |
|------|-------|--------|-------|
| [name] | [suite] | Still failing | [details] |

### Flaky Tests
| Test | Suite | Notes |
|------|-------|-------|
| [name] | [suite] | Failed on first run, passed on retry |

### Console Errors
[Any console errors observed across all suites, grouped by page/route]

### Recommended Actions
- **Investigate**: [list of new failures that need attention]
- **Monitor**: [list of flaky tests that may need stabilization]
- **Update tests**: [list of tests that may be stale — testing features that changed]
```

---

## Key Principle: Observe Only

This command does NOT attempt to fix code or tests. Regression failures might indicate:
- A real bug (recent code change broke something)
- An environment issue (staging data differs from expected)
- A stale test (the feature was intentionally changed, test wasn't updated)
- An intentional behavior change (product decision, not a bug)

Only a human has enough context to decide. Report the evidence, let them choose.

## Phase 5 §5.5 — automatic dev_task escalation

The runner emits structured `error.class` entries on each failed primitive. The backend `save_execution_log` route (per Phase 5 §5.5) automatically:
- Creates a `regression_failure` dev_task per failed test (`assigned_team='qa'`, `priority='medium'`)
- Creates a `self_heal_review` dev_task per component that triggered a Tier-1 ladder rescue mid-run
- Emits `test_stale_candidate` events on `test_coverage_events` for the QA Kanban + any session running an authoring skill to react

You don't need to file dev_tasks manually for failures — they appear on the QA Kanban automatically. Your job is to **report them in the run summary** with links so the user / QA agent can triage from one place.

## Phase 5 §4.7.1 — branch / PR / environment attribution

If invoked with `--branch <name>` / `--git-sha <sha>` / `--environment <id>` flags, the runner annotates every `test_executions` row with these. Per-environment signatures (`test_cases.signed_environments[]`) — a test signed against staging does NOT auto-promote to prod; each env signs independently. Surface per-env pass rate in the report when more than one environment is in scope.

## Common error.class hints (for the regression report)

| error.class | What to write in "Recommended Actions" |
|---|---|
| `element_not_found` (mass) | "Recent UI change likely renamed selectors — run /st4ck:impact on the recent merge to surface affected components" |
| `element_not_actionable` | "Possible modal overlay or load timing — investigate via /st4ck:debug" |
| `check_failed` (LLM verdict fail) | "Agent's actionable_hint may suggest the fix; surface it to QA reviewer" |
| `do_replay_failed` | "Cached component drifted; delete the component md to force re-record on next run" |
| `pause_aborted` | "Agent aborted mid-pause; check the abort reason — usually a real product issue" |

---

## Scheduling

This command can be scheduled for nightly runs:
```
/schedule "Nightly regression" --cron "0 2 * * *" --prompt "/regression-run all"
```
