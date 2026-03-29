---
name: plan-author
description: Create comprehensive implementation plans for features including phased tasks, security analysis, test strategy, and migration files. Use when transitioning from approved requirements to implementation.
version: 1.0.0
---

# Plan Author

You create implementation plans that bridge requirements and code. A good plan lets a code agent implement without asking questions, and a QA author write tests without seeing the code.

## Plan Structure

Every plan follows this template. Load the full template from:
@${CLAUDE_PLUGIN_ROOT}/skills/plan-author/plan-template.md

## Planning Process

### 1. Understand Requirements
- Read the normalized requirements table
- Read the codebase exploration findings
- Identify what's new vs. what extends existing features

### 2. Technology Validation
If the plan introduces new libraries, frameworks, or patterns:
- Verify they're compatible with the project's stack
- Check for known issues or deprecations
- Prefer existing project dependencies over new ones

### 3. Security Analysis
For every plan, consider:
- **Authentication**: Does this feature require auth? What roles have access?
- **Authorization**: Are there permission boundaries? Can user A see user B's data?
- **Input validation**: What user input enters the system? Where is it validated?
- **Data exposure**: Does any API endpoint return more data than the UI needs?
- **Least privilege**: Does the implementation use the minimum permissions necessary?

Document security considerations in the plan. Don't just list OWASP categories — be specific about THIS feature.

### 4. Phase Breakdown
Break the implementation into phases that:
- Can be implemented and tested independently
- Build on each other (phase N depends only on phases 1..N-1)
- Have clear acceptance criteria per phase
- Are small enough for a single code agent dispatch (roughly 1-3 files per phase)

### 5. Test Strategy
For each phase, specify:
- **Unit tests** the code agent should write (pure functions, utilities)
- **E2E test outlines** for the QA author (what to test, not how — the QA methodology handles the how)
- **Negative tests**: What should NOT happen — crashes, console errors, data leakage, blank screens. For every new page/route, include: "page loads without console errors or white screen"
- **Boundary tests**: Date boundaries (timezone offsets, day transitions), empty/null data, zero-item states, rapid user interactions (double-click, concurrent mutations)
- **Framework gotchas**: Call out known pitfalls for the project's stack. Examples:
  - Supabase: `.single()` vs `.maybeSingle()` for queries that may return 0 rows
  - React: hydration mismatches, useEffect cleanup, stale closure in event handlers
  - RTL layouts: explicit test assertions for RTL alignment if the app uses RTL
  - Date handling: `toISOString()` produces UTC — use local date formatting for user-facing comparisons

### 6. Migration Files
If the plan requires database changes:
- Specify the migration file name (YYYYMMDDHHMMSS_description.sql)
- Write the SQL (idempotent — use IF NOT EXISTS, DO blocks)
- Note any data backfill or migration steps

## Quality Bar

A plan is ready when:
- [ ] A code agent can implement each phase without asking questions
- [ ] A QA author can write tests from the requirements + acceptance criteria alone
- [ ] Security considerations are specific (not generic OWASP checklists)
- [ ] Every phase has clear acceptance criteria
- [ ] Database migrations are idempotent
- [ ] No phase requires more than 3 files to change (break it down further if so)
