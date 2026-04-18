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

For each test in the suite, run the **deterministic runner** (zero LLM cost):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> --session "st4ck-reg-$(date +%s)"
```

The runner reads `ST4CK_TOKEN` from the environment. Claude Code automatically sets it from the `headers.Authorization` value in `.mcp.json`. Do not pass it inline.

### Execution flow per test:
1. Run `run-test.js` — handles deterministic blocks + profile locking internally
2. Handle exit codes:
   - **0**: Test passed — record result, continue to next test
   - **1**: Test failed — search `search_test_knowledge` with the error pattern before diagnosing from scratch. Record failure with evidence, continue to next test
   - **42**: Agentic pause — see "Handling Agentic Pauses" below. Handle the block yourself, update structured_log, resume with `--continue --from-block <next>`, repeat until 0 or 1

### Handling Agentic Pauses (exit 42)

**Agentic blocks are a LAST RESORT.** They should only exist when the block requires runtime decision-making (branching on unpredictable state, visual judgment, or dynamic query construction). "Complex UI" is never a valid reason — date pickers, edit dialogs, and Radix dropdowns are all scriptable as components. If you encounter an agentic block that looks scriptable, flag it in the report.

On exit 42, the runner writes a JSON pause envelope to **stdout** (not stderr — stderr holds progress logs). Parse that JSON first — everything you need is in it:

```json
{
  "status": "agentic_pause",
  "block": 3,
  "action": 0,
  "execution_id": "exec-...",
  "test_case_id": "test-...",
  "block_mode": "agentic",             // "agentic" = whole block | "scripted" = single action paused
  "agentic_brief": "Verify today's daily order...",  // primary instruction for block-level pauses
  "block_info": {
    "block_type": "backend",
    "role": "Customer",
    "properties": { "cross_company": true },
    "entry_url": null,
    "expected_outcome": "Order exists with submitted status and 1+ line items"
  },
  "captures": { "daily_order_id": "1712345678x999", ... },  // values captured by earlier scripted blocks
  "next_step": "Execute the brief..., then resume with: node ... --continue ... --from-block 4"
}
```

**Two pause shapes you will see:**

1. **Block-level agentic (`block_mode: "agentic"`)** — the block is fully agentic. Use `agentic_brief` + `block_info.expected_outcome` as your brief. The block has no scripted actions to mimic. This should be rare — only for blocks that genuinely require runtime decision-making (e.g., dynamic backend queries where the query shape depends on runtime data).

2. **Action-level agentic (`block_mode: "scripted"`, legacy fallback)** — a single action inside an otherwise scripted block is marked `type: "agentic"`. This is the old fallback from the pre-block_mode era. Use `get_test_details(test_case_id)` to pull the block's full action list, find the paused action by index, and fulfill it.

**Execution steps for block-level agentic blocks:**

1. **Acquire profile if needed**: if `block_info.role` is set, call `acquire_profile(role: block_info.role, properties: block_info.properties, environment_id: <env>)` to get credentials. Remember to release it when done.
2. **Execute the brief** using your own tools:
   - Frontend work: `agent-browser` CLI via `Bash` (same session the runner was using — `st4ck-reg-<timestamp>`)
   - Backend work: `mcp_call` on the V1 data endpoint via the `mcp__st4ck__bubble_list_records` / `mcp__st4ck__supabase_query` tools
3. **Reference captures**: if `captures.daily_order_id` exists, use it in your queries — that's the order the scripted block created before the pause.
4. **Decide pass/fail**: write a short verdict + evidence (row count, field values, screenshot path).
5. **Update the execution log**: call `save_execution_log({execution_id, test_case_id, status: "running", structured_log: {...}})` where `structured_log.blocks[N]` for the paused block has `status: "passed"` (or `"failed"`), your verdict, and any evidence. The runner reads this log on `--continue` and skips any block already marked `"passed"`.
6. **Resume the runner**: `node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js <test_id> <base_url> --continue <execution_id> --from-block <N+1>`. The runner reads `ST4CK_TOKEN` from env.
7. **If your verdict was "failed"**: don't resume. Record the failure for the report and move to the next test.

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
   - Exit 1: **do not retry**. Record failure with evidence (include `log.console_errors` from the saved execution log — the runner now captures browser console on every failure), continue.
   - Exit 42: handle the pause, resume with `--continue`. Never retry a pause — either the agentic step passed or it didn't.
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

---

## Scheduling

This command can be scheduled for nightly runs:
```
/schedule "Nightly regression" --cron "0 2 * * *" --prompt "/regression-run all"
```
