# Fix Loop

When the QA Runner reports confirmed failures (not flakiness), the orchestrator manages the fix loop.

## Constants

```
MAX_ATTEMPTS_PER_ISSUE = 3
GLOBAL_CAP = 8  # total fix iterations across ALL issues
```

## Loop Logic

Read the current state from `.st4ck/implement-state.json` for attempt counts and iteration totals.

```
For each confirmed failure from the QA Runner:

1. **Search the knowledge base FIRST**: call `search_test_knowledge` with the error message or symptom. If a known solution exists, apply it before dispatching agents. This can resolve the issue in one tool call instead of a full fix cycle.

2. Read the runner's diagnosis:
   - code_bug → dispatch Code Agent to fix
   - test_bug → dispatch QA Author to fix
   - environment → STOP, report to human (can't fix environment issues)
   - exceeded_block_budget / same_action_exhausted → SKIP, report to human (agent hit automation budget — not a code or test bug, needs manual investigation or test simplification)

2. Track attempts per issue:
   attempts[issue_id] = { count: N, classification: "code_bug"|"test_bug", reclassified: false }

3. Execute the fix:
   If code_bug:
     → Dispatch code-agent with: the failure details, the runner's evidence, the specific file/component
     → After fix: re-run code-reviewer (Step 3b) on the changed files
     → Then: re-run ALL tests (not just the failing one) — this is the no-regression gate

   If test_bug:
     → Dispatch qa-author with: the failure details, the runner's evidence, the test case ID
     → After fix: re-run qa-reviewer (Step 3d) on the modified test
     → Then: re-run ALL tests

4. Check results:
   If the original failure is resolved AND no new failures:
     → Issue fixed. Remove from failures list.

   If the original failure is resolved BUT new failures introduced:
     → Count as a failed attempt for the original issue
     → Add new failures to the list

   If the original failure persists:
     → Reclassification (ONE FLIP ONLY):
       If NOT already reclassified:
         Flip classification: code_bug ↔ test_bug
         Mark as reclassified
         Try again with the new classification
       If ALREADY reclassified:
         Both classifications failed. STOP for this issue.
         Report to human with evidence from both attempts.

5. Increment counters:
   attempts[issue_id].count += 1
   totalIterations += 1

6. Check exit conditions:
   If attempts[issue_id].count >= MAX_ATTEMPTS_PER_ISSUE:
     STOP for this issue. Report to human.
   If totalIterations >= GLOBAL_CAP:
     STOP ALL. Report everything to human.
```

## State File Updates

After every fix attempt, update `.st4ck/implement-state.json`:

```json
{
  "attempts": {
    "[issue_id]": {
      "count": 2,
      "classification": "test_bug",
      "reclassified": true,
      "history": [
        { "attempt": 1, "classification": "code_bug", "result": "still_failing" },
        { "attempt": 2, "classification": "test_bug", "result": "fixed" }
      ]
    }
  },
  "totalIterations": 3
}
```

## Exit Conditions Summary

The fix loop STOPS when ANY of these are true:

1. **All failures resolved** → proceed to Phase 4
2. **An issue hits MAX_ATTEMPTS_PER_ISSUE (3)** → stop for that issue, continue others
3. **Total iterations hit GLOBAL_CAP (8)** → stop ALL, report everything
4. **Both classifications failed for an issue** (reclassification exhausted) → stop for that issue
5. **Environment issue diagnosed** → stop immediately, report to human
6. **Budget exceeded** (`exceeded_block_budget`, `same_action_exhausted`) → skip the issue, continue with other failures

## Reporting to Human

When the fix loop stops with unresolved issues, present:

```
## Fix Loop Report

### Resolved ([N] issues)
- [Issue]: fixed via [code fix | test fix] on attempt [N]

### Unresolved ([N] issues)
- [Issue]:
  - Attempts: [N]
  - Classification history: [code_bug → test_bug]
  - Evidence: [what was tried and what happened]
  - Runner's last diagnosis: [details]
  - Recommendation: [manual investigation needed because...]

### Fix Loop Stats
- Total iterations: [N] / [GLOBAL_CAP]
- Issues resolved: [N] / [total]
- New regressions introduced during fixes: [N]
```
