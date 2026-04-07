# Phase 3: Autonomous Implementation Loop

This phase is the core autonomous zone. You (the orchestrator) dispatch agents and manage the loop. The human has approved the plan — now execute it.

## State Management

Before starting, initialize the state file:

```
Create .st4ck/implement-state.json with:
{
  "phase": "3",
  "subPhase": "3a",
  "branch": "[feature-branch-name]",
  "plan": "[path to plan file]",
  "suiteIds": [],
  "testCaseIds": [],
  "attempts": {},
  "totalIterations": 0,
  "globalCap": 8,
  "agentResults": {},
  "specStatusBackups": {}
}
```

Update this file after every significant state change. This is your source of truth — if context compaction occurs, read it back.

## Parallel Track Design

Code and QA authoring run in **parallel** — they have zero data dependencies:

- **Track A (Code)**: Code Agent implements → Code Reviewer reviews
- **Track B (QA)**: QA Author writes tests → QA Reviewer reviews and signs

After both tracks complete, they converge for execution:
- **QA Runner** executes signed tests against the implemented code

Launch Track A and Track B simultaneously using parallel Agent calls.

## Track A: Code Implementation

### Step 3a: Code Agent

For each phase in the plan:

1. Create a feature branch if not already created:
   ```
   git checkout -b [feature-branch] from main
   ```

2. Dispatch the **code-agent** with:
   - The plan phase tasks (from the approved plan)
   - Codebase context (from Phase 1 exploration)
   - The branch name

3. When the agent returns, validate against the dispatch contract:
   - Files changed listed?
   - Unit test results included?
   - Quality gates (lint, types, tests) all passing?
   - Task statuses reported?

4. If quality gates fail, dispatch code-agent again to fix. Max 2 retries.

5. Update state file with results:
   ```json
   "agentResults.codeAgent": { "filesChanged": [...], "unitTests": "X/Y", "qualityGates": "pass/fail" }
   ```

### Step 3b: Code Review

After code agent completes successfully:

1. Get the git diff:
   ```
   git diff main...[feature-branch]
   ```

2. Dispatch the **code-reviewer** with:
   - The git diff
   - The plan's requirements
   - Codebase context

3. Read the review findings:
   - **Critical/High findings** → dispatch code-agent to fix → re-review (max 2 cycles)
   - **Medium findings** → note for human in final report
   - **No critical/high findings** → Track A complete

4. Update state file:
   ```json
   "agentResults.codeReview": { "verdict": "PASS/FAIL", "criticalCount": N, "highCount": N, "mediumCount": N }
   ```

## Track B: QA Test Authoring

### Step 3c: QA Author

Launch in parallel with Track A:

1. Prepare QA Author context and dispatch the **qa-author** with:
   ```
   ## Test Authoring Assignment

   ### Suite ID: [uuid] (create with create_test_suite first)
   ### Suite Category: version
   ### Profile IDs: [role]=[uuid], [role]=[uuid] (from get_test_profiles)

   ### Approved Test Journeys (CONTRACT — implement ALL rows marked Ready)
   [Copy the FULL Test Journeys table from the approved plan]

   This table is your contract. You MUST implement every row with Status=Ready.
   You MAY add edge cases you discover during code reading, but you CANNOT
   drop any planned flow. The user already approved this coverage.

   ### Source Material:
   - Requirements: [the plan's requirements table]
   - Acceptance criteria: [from spec documents if available]
   - App navigation: [sidebar labels, route names from Phase 1 explorers]

   ### Context from Phase 1:
   - Key UI labels found: [from explorer agents]
   - Routes: [relevant routes]
   - User roles: [roles and permissions]
   ```

   The qa-author has the full methodology preloaded via its skill. It starts at step 3 (deep dive). Pass the Phase 1 exploration results so it doesn't re-explore.

2. When the agent returns, validate:
   - Suite ID created?
   - Test case IDs listed?
   - **Journey coverage**: every row in the Test Journeys table (Status=Ready) has a corresponding test case?
   - **Edge cases**: all edge rows from the plan are covered?
   - Any additional edge cases the author discovered beyond the plan?
   - **Component existence**: call `get_components()` and verify every component referenced by `{component, method}` actions in the authored tests exists. Missing components = coverage gap.

3. If coverage gaps exist (planned flows not implemented, or referenced components missing), dispatch qa-author again with the specific missing rows or components.

4. Update state file:
   ```json
   "suiteIds": ["[suite-id]"],
   "testCaseIds": ["[id1]", "[id2]", ...],
   "agentResults.qaAuthor": { "suiteId": "...", "testsCreated": N, "coverageGaps": [...] }
   ```

### Step 3d: QA Review

After QA Author completes:

1. Dispatch the **qa-reviewer** with:
   - The test case IDs from QA Author's output
   - The plan's requirements (for cross-reference)

2. Read the review results:
   - All signed → Track B complete
   - Some rejected → dispatch qa-author to fix → re-review (max 2 cycles)

3. Update state file:
   ```json
   "agentResults.qaReview": { "signed": N, "rejected": N, "issues": [...] }
   ```

## Convergence: Smoke Gate + QA Execution

### Step 3e: Smoke Gate

After Track A completes but BEFORE dispatching QA Runner, run a quick smoke check to catch crashes and silent errors early. This saves full fix loop iterations.

1. Start the app (if not already running)
2. Navigate to each new/modified route from the plan
3. For each route, check:
   - **Page renders** (no white screen / blank page)
   - **Zero console errors** (`browser_console_messages` — no uncaught exceptions, no React errors)
   - **Zero 4xx/5xx responses** in network requests (no API failures on page load)

4. If ANY smoke check fails:
   - Dispatch **code-agent** to fix the specific issue (with the console error / network failure as context)
   - Re-run smoke gate after fix
   - Max 2 smoke fix attempts — if still failing, report to human with evidence

5. Update state file:
   ```json
   "agentResults.smokeGate": { "routes_checked": N, "console_errors": N, "network_errors": N, "verdict": "PASS/FAIL" }
   ```

**Rationale**: TDZ crashes, missing imports, and query errors produce white screens or 406 errors that are trivially detectable before running the full test suite. Catching them here avoids wasting QA execution time.

### Step 3f: QA Runner

After smoke gate passes AND Track B completes:

1. Dispatch the **qa-runner** with:
   - Suite ID(s) from QA Author
   - Signed test case IDs
   - App URL / environment info
   - Model: Haiku (hardcoded — do NOT override to a more expensive model)
   - Budget limits: 100 tool calls/block (hard limit), 3 approaches/failed action

2. Read the execution results:
   - **All green** → proceed to Phase 4
   - **Flaky tests** → note in report, no fix loop
   - **Budget exceeded** (`exceeded_block_budget`, `same_action_exhausted`) → report to human, do NOT enter fix loop (these are agent automation limits, not code/test bugs)
   - **Confirmed failures** → enter fix loop (Step 3g)

3. Update state file:
   ```json
   "agentResults.qaRunner": { "passed": N, "failed": N, "flaky": N, "failures": [...] }
   ```

### Step 3g: Fix Loop

If there are confirmed failures, include the fix loop logic:

@${CLAUDE_PLUGIN_ROOT}/shared/implement-fix-loop.md

## After Phase 3

After the fix loop resolves (or exhausts attempts):

1. Summarize all agent results to the state file
2. **Discard raw agent outputs from conversational context** — the state file summary is sufficient
3. Proceed to Phase 4 (results presentation)
