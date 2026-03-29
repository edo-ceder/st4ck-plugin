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
   - Phased tasks with acceptance criteria
   - Security analysis specific to this feature
   - Test strategy (unit tests per phase, QA journey outlines)
   - Migration files if needed

2. Save the plan to a file: `docs/development-plans/[date]_[feature-name].md`

### Human Gate 2

Present the full plan to the user.

**STOP. Wait for human approval.**

If the human requests changes, revise the plan and re-present. Do NOT proceed without explicit approval (e.g., "looks good", "approved", "go ahead").

---

## Phase 3: Autonomous Implementation Loop

The human has approved. Now execute.

@${CLAUDE_PLUGIN_ROOT}/shared/implement-phase3.md

---

## Phase 4: Results

Present the completion report to the user:

```markdown
## Implementation Report

### Requirements Coverage
| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| R1 | [description] | Implemented / Partial / Blocked | [what was built] |

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
