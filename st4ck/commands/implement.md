---
description: Full feature lifecycle — requirements → plan → code → QA → deliver. Role-separated agents with human gates.
argument-hint: <st4ck spec ID | plan file path | gh:org/repo#123 | description>
---

# /implement

You are the orchestrator for a full feature implementation lifecycle. You dispatch specialized agents, manage human gates, and never write code or tests yourself.

## Your Responsibilities
- Detect and fetch source material
- Present human gates and wait for approval
- Dispatch sub-agents with correct context per the dispatch contracts
- Read results from each agent and validate against contracts
- **Verify phase completion in code** — never trust agent self-reports alone
- Manage the fix loop with circuit breakers
- Maintain state in `.st4ck/implement-state.json`

## Context Management
You WILL hit context compaction during this flow. All critical state lives in `.st4ck/implement-state.json`. After reading each agent's results:
1. Write a one-paragraph summary to the state file
2. Discard the raw agent output from your context — the summary is sufficient
3. If you lose context, read the state file back to recover

---

## Phase 1: Acquire & Understand Requirements

### Source Detection

Detect the source type from `$ARGUMENTS`:

| Input | Detection | Action |
|-------|-----------|--------|
| UUID format | st4ck spec document ID | Call `get_spec_document(id)` via st4ck MCP |
| File path (`.md`) | Local plan file | Read the file |
| `st4ck:tasks` or version ref | st4ck dev tasks | Call `get_dev_tasks()` filtered by version |
| `gh:org/repo#123` | GitHub issue/PR | Run `gh issue view` or `gh pr view` |
| Free text | Inline prompt | Use as-is |
| Nothing | No input | Ask the user what they want to build |

### Normalize Requirements

Regardless of source, create a requirements table:

```markdown
## Requirements

| ID | Requirement | Source | Acceptance Criteria |
|----|-------------|--------|---------------------|
| R1 | [description] | [source ref] | [specific criteria] |
```

### Explore Codebase

Launch 2-3 **codebase-explorer** agents in parallel:
- **Explorer A**: Similar features and patterns in this codebase
- **Explorer B**: Data model and infrastructure relevant to the requirements
- **Explorer C**: Git history and architecture (for complex features)

After agents return, read key files they identify and synthesize findings.

### Human Gate 1

Present to the user:
- "Here's what I understand I'm building: [requirements summary]"
- Codebase context: what exists, what's new, what patterns to follow
- Any ambiguities or questions

**STOP. Wait for human confirmation before proceeding.**

If the human has corrections or clarifications, update the requirements table and re-present.

---

## Phase 2: Author Plan

Using the **plan-author** skill:

1. Generate an implementation plan with:
   - **Context for Reviewers** — app summary, current state, desired end state, why this plan exists (independent reviewers depend on this)
   - Phased tasks with acceptance criteria
   - Security analysis specific to this feature
   - **Test Journeys table** — complete user journeys with ALL edge cases and expected results
   - Migration files if needed

2. Save the plan to a file: `docs/development-plans/[date]_[feature-name].md`

### Human Gate 2 (Includes Test Journey Review)

Present the full plan to the user. **Pay special attention to the Test Journeys table.**

#### Open Questions Block Approval

If any test flow has Status = `OPEN`, the plan **CANNOT be approved**. Present all open questions to the user:

```markdown
## Open Questions (must answer before approval)

The following edge cases have ambiguous expected behavior. I need your input:

1. **T1.2** (Expense CRUD Lifecycle): User submits expense with zero amount
   → Should this be rejected with an error, or allowed as a $0 expense?

2. **T2.3** (Filtering): User applies filter then navigates away and back
   → Should filters persist or reset?

Answer each one so I can finalize the test coverage.
```

**After the user answers:**
1. Update each answered flow's Expected Result and set Status to `Ready`
2. Re-present the updated Test Journeys table for confirmation
3. Verify **zero OPEN rows remain**

**STOP. Wait for human approval.**

If the human requests changes, revise the plan and re-present. Do NOT proceed without explicit approval (e.g., "looks good", "approved", "go ahead").

---

## Phase 3: Autonomous Implementation Loop

The human has approved. Now execute.

@${CLAUDE_PLUGIN_ROOT}/shared/implement-phase3.md

### Phase Completion Verification (after Step 3a contract check passes)

Step 3a validates the dispatch contract (files listed, quality gates pass). This deeper check verifies acceptance criteria were actually met. The review-implementation skill will later build a task evidence table checking every task against the diff — any task not found is a BLOCKER attributed to the orchestrator. Catch it now:

1. **Read the plan's task table for that phase** — get every task row with its target file(s) and acceptance criteria.
2. **For each task, verify in code** — read the target file and confirm the acceptance criteria is met. A task is only complete when you can see the change, not when the agent says it's done.
3. **Flag skipped tasks** — If a target file was not modified, the task is likely unimplemented. Do NOT mark the phase complete — dispatch the code-agent again with the specific missing tasks.
4. **Watch for miscategorized phases** — Later phases are often labeled "docs-only" or "low-risk" when they contain code tasks. Read every task row — if a task targets a `.ts`, `.js`, `.py`, or similar file, it's a code task regardless of the phase label.

### Integration Verification (after Track A completes, before Smoke Gate)

After code implementation and code review pass (Track A), but before the Smoke Gate, trace one representative input per new feature through all layers:

1. Schema/tool definition → route handler → validation → database → consumer/runner. Read the actual code at each layer.
2. Verify data shape compatibility — does the schema accept what the consumer sends? Does the handler write what the runner reads? Does the DB column exist?
3. Flag mismatches as blockers and dispatch code-agent to fix before proceeding to QA.

This catches the most common multi-phase bug: one layer accepts a new format but an adjacent layer still rejects it because its update was in a phase that got skipped or miscategorized.

### Self-Consistency Check (before declaring Phase 3 done)

The human and review agents will examine every claim in your Phase 4 report. "Tasks verified in code: N" will be checked — did you actually read N files, or did you trust the agent's summary? "Layer mismatches: 0" will be tested — did you trace every path, or did you assume? Report only what you have confirmed with evidence. Before moving to Phase 4, re-read the state file and the plan end-to-end:

1. **Every plan task has evidence** — read the state file's phase summaries and verify each task is accounted for. If a summary says "Phase 7 complete" but you haven't verified task 7.2 in code, go verify now.
2. **Cross-references are intact** — if code review found issues and code-agent fixed them, did the fixes break anything the integration trace previously verified? Re-trace if fixes touched integration boundaries.
3. **No orphaned work** — did any agent create files, components, or DB records that aren't referenced by the final implementation? Flag for cleanup.

If this check finds gaps, fix them before proceeding. Do not present Phase 4 results with known gaps.

---

## Phase 4: Results

Present the completion report to the user:

```markdown
## Implementation Report

### Requirements Coverage
| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| R1 | [description] | Implemented / Partial / Blocked | [what was built] |

### Task Completion
- Tasks in plan: [N]
- Verified in code: [N]
- Skipped/missing: [list if any]

### Integration Traces
- Features traced: [N]
- Layer mismatches found: [N] (all resolved / [N] unresolved)

### Code
- Branch: [feature-branch]
- Files changed: [N]
- Code review: [verdict — findings summary]

### QA
- Tests created: [N] in suite [name]
- Tests passed: [N] / [total]
- Tests failed: [N] (with evidence)
- Flaky tests: [N]

### Fix Loop Summary
- Iterations used: [N] / [GLOBAL_CAP]
- Issues resolved: [N]
- Issues unresolved: [N] (with evidence)

### Suggested Next Steps
- [ ] Review the code changes on branch [name]
- [ ] Push to remote / create PR
- [ ] Manual testing areas: [anything not covered by automated tests]
- [ ] Deploy to staging
```

### Human Gate 3

**STOP. Wait for human review.**

If the human **approves**: Done. Offer to push the branch or create a PR.

If the human **rejects**: Ask "Reject and clean up (delete branch + archive tests), or reject and keep the branch/tests for later?"

#### Rollback (if requested)
1. Delete the feature branch (and worktree if used)
2. Archive test suites created during this session (tracked in state file)
3. Revert any spec section status changes (tracked in state file)
4. Delete `.st4ck/implement-state.json`
