# Agent Dispatch Contracts

This document defines the expected input and output format for each agent. The orchestrator validates that agent output matches these contracts before proceeding.

## Code Agent

### Input
```
## Assignment

### Plan Phase
[Phase name and number]

### Tasks
| # | Task | Acceptance Criteria |
|---|------|---------------------|
| 1 | [task description] | [specific criteria] |

### Codebase Context
[Key files, patterns, and architecture notes from Phase 1 exploration]

### Branch
Working on branch: [branch-name]
```

### Expected Output
```
## Code Agent Report

### Files Changed
| Action | File | Description |
|--------|------|-------------|
| created | [path] | [what it does] |
| modified | [path] | [what changed] |

### Unit Tests
- Total: [N] | Passed: [N] | Failed: [N]
- [test file]: [pass/fail details]

### Quality Gates
- Lint: [pass/fail]
- Type check: [pass/fail]
- Unit tests: [pass/fail]

### Task Status
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | [task] | complete/partial/blocked | [details if not complete] |
```

### Timeout
10 minutes. If exceeded, orchestrator kills the agent and reports partial results.

### Retry Policy
1 automatic retry on crash/timeout. If retry also fails, report to human.

---

## Code Reviewer

### Input
```
## Review Assignment

### Requirements
[The plan's requirements table]

### Changes to Review
[git diff output or branch reference]

### Codebase Context
[Key architecture notes relevant to the changes]
```

### Expected Output
```
## Code Review Report

### Summary
[1-2 sentence overview: "X findings across Y files, Z critical"]

### Critical (must fix)
**[C1]** [file:line] — [summary]
Confidence: [80-100]
Evidence: [specific explanation]
Suggested fix: [brief]

### High (should fix)
**[H1]** [file:line] — [summary]
Confidence: [80-100]
Evidence: [specific explanation]
Suggested fix: [brief]

### Medium (note for human)
**[M1]** [file:line] — [summary]
Confidence: [80-100]
Evidence: [specific explanation]

### Verdict
[PASS — no critical/high findings | PASS WITH NOTES — medium findings only | FAIL — critical or high findings require fixes]
```

### Timeout
5 minutes.

### Retry Policy
1 automatic retry on crash/timeout.

---

## QA Author

### Input
```
## QA Assignment

### Requirements
| ID | Requirement | Source | Acceptance Criteria |
|----|-------------|--------|---------------------|
| R1 | [description] | [source] | [criteria] |

### App Navigation
[Sidebar structure, route names, key UI labels from Phase 1 exploration]

### Test Profiles Available
[List of profile IDs and their roles]

### Existing Test Suites
[Any existing suites to avoid duplicating — or "none"]

### Suite Category
[version | regression]
```

### Expected Output
```
## QA Author Report

### Suite Created
- Suite ID: [uuid]
- Suite Name: [name]
- Category: [version/regression]

### Test Cases Created
| # | Test ID | Test Name | Requirement(s) Covered | Blocks |
|---|---------|-----------|----------------------|--------|
| 1 | [uuid] | [name] | R1, R2 | [N] |

### Coverage Mapping
| Requirement | Test Case(s) | Edge Cases |
|-------------|-------------|------------|
| R1 | TC-1, TC-3 | empty state, error |
| R2 | TC-2 | boundary values |

### Gaps
[Any requirements that couldn't be fully tested, with explanation]
```

### Timeout
10 minutes.

### Retry Policy
1 automatic retry on crash/timeout.

---

## QA Reviewer

### Input
```
## Review Assignment

### Test Cases to Review
[List of test case IDs from QA Author's output]

### Requirements
[Same requirements table given to QA Author — for cross-reference]
```

### Expected Output
```
## QA Review Report

### Per-Test Verdicts
| Test ID | Test Name | Verdict | UI Strings | Routes | Methodology | Signed |
|---------|-----------|---------|-----------|--------|-------------|--------|
| [uuid] | [name] | PASS/FAIL | [X/Y] | [X/Y] | OK/Issues | Yes/No |

### Issues Found
**[Test Name]** (ID: [uuid])
- [Issue description with evidence]
- [Issue description with evidence]

### Overall
- Reviewed: [N] tests
- Signed: [N] tests
- Rejected: [N] tests (require fixes)
```

### Timeout
8 minutes.

### Retry Policy
1 automatic retry on crash/timeout.

---

## QA Runner

### Input
```
## Execution Assignment

### Suite
Suite ID: [uuid]
Suite Name: [name]

### Test Cases
[List of signed test case IDs to execute]

### Environment
[App URL, any environment-specific config]
```

### Expected Output
```
## QA Execution Report

### Suite: [name] (ID: [uuid])
Total: [X] tests, [Y] blocks
Passed: [N] | Failed: [N] | Flaky: [N] | Error: [N] | Skipped: [N]

### Results Per Test
| Test ID | Test Name | Status | Blocks | Duration |
|---------|-----------|--------|--------|----------|
| [uuid] | [name] | passed/failed/error | [X/Y passed] | [Ns] |

### Failed Tests (with diagnosis)
**[Test Name]** (ID: [uuid])
- Block [N]: [block description]
- Diagnosis: [code_bug | test_bug | flakiness | environment]
- Expected: [what test expected]
- Actual: [what browser showed]
- Evidence: [screenshot reference, console errors]
- Recommendation: [what to fix and who should fix it]

### Flaky Tests
**[Test Name]** — failed on first run, passed on retry. [details]

### Console Errors
[Any console errors observed, grouped by page/route]
```

### Timeout
15 minutes per suite.

### Retry Policy
1 automatic retry on crash/timeout.
