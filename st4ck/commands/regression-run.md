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
   - "Z tests have no profile — link profiles in st4ck before running"

4. If all tests are ready, confirm:
   ```
   Ready to execute [N] tests across [M] suites. Proceed?
   ```
   Wait for confirmation before starting execution.

---

## Execute

For each suite, dispatch a **qa-runner** agent with:
- Suite ID
- List of ready test case IDs
- App URL / environment info
- Model: Haiku (hardcoded in agent definition — do NOT override)
- Budget limits: 100 tool calls/block (hard limit), 3 approaches/failed action

If multiple suites are being run, dispatch runners sequentially (one suite at a time) to avoid concurrent browser session issues.

After each runner returns:
1. Write summary to a results file (`.st4ck/regression-results-[date].json`)
2. Discard raw runner output from context

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
