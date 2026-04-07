---
name: plan-author
description: Create comprehensive implementation plans for features including phased tasks, security analysis, test strategy, and migration files. Use when transitioning from approved requirements to implementation.
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

### 5. Test Strategy — Test Journeys & Edge Cases (CRITICAL)

This is the most important section of the plan. The QA author implements exactly what you define here. If you miss a flow, it won't be tested. If the expected result is wrong, the test verifies the wrong thing.

#### Unit Tests (per phase)
Specify pure functions and utilities the code agent should unit-test.

#### Test Journeys (for QA Author)

**E2E tests are JOURNEYS, not individual operations.** A journey is a complete user flow: login → setup → action → verification. "Create expense" and "Delete expense" are NOT separate e2e tests — they are steps within an "Expense CRUD lifecycle" journey.

**Smoke tests CAN be individual checks** (1-2 blocks, shallow, fast gate checks). But any test typed `e2e` or `acceptance` MUST be a multi-step journey that exercises a real user workflow end-to-end.

#### Every E2E Journey Creates Its Own Data (Non-Negotiable)

Every e2e journey MUST start with data creation steps via the UI. No journey may assume pre-existing data — it must work on a clean environment with only login credentials.

**Wrong:** `Switch tabs → filter by category → change month`
(What data? Who created the expenses to filter? This fails on a clean DB.)

**Right:** `Create 3 expenses (variable + fixed + commitment) → switch tabs → filter by category → change month → verify filters persist`
(Journey creates its own data first, then exercises the feature.)

If a journey tests filtering, it starts by creating filterable data. If it tests deletion, it starts by creating something to delete. The first steps of every e2e journey are setup — always via UI, never SQL.

For every requirement, define test journeys with ALL edge cases. Use this table format:

```markdown
| ID | Journey | Flow | Type | Expected Result | Status |
|----|---------|------|------|-----------------|--------|
| T1 | Expense CRUD Lifecycle | Create expense via form → verify in list → edit amount → verify update → delete → verify gone | e2e | Each step succeeds, list reflects changes, deletion removes from list and DB | Ready |
| T1.1 | Expense CRUD Lifecycle | Create with special chars in name (emoji, quotes) | edge | Saved, displayed verbatim without encoding | Ready |
| T1.2 | Expense CRUD Lifecycle | Create with zero amount | edge | ⚠️ OPEN — Should zero be rejected or allowed? | Open |
| T1.3 | Expense CRUD Lifecycle | Create duplicate name | edge | Error "Expense name already exists", no duplicate created | Ready |
| T2 | Expense Filtering | Create 3 expenses (variable, fixed, commitment) → switch tabs → filter by category → change month → verify filters persist | e2e | Filters survive tab switch and month navigation, correct data shown per filter | Ready |
| T2.1 | Expense Filtering | Navigate to month with no expenses (no setup needed) | edge | "No expenses this month" message, no broken UI | Ready |
| T3 | Access Control | Owner creates expense → switch to viewer role → viewer sees but can't edit → viewer attempts create → blocked | e2e | Viewer sees data, mutation UI hidden/disabled, direct API returns 403 | Ready |
| S1 | Smoke | Navigate to expenses page | smoke | Page loads, list renders, zero console errors | Ready |
```

**Column rules:**
- **ID**: `T[journey].[flow]` for e2e/edge, `S[n]` for smoke
- **Journey**: Named journey. Multiple flows share a journey name.
- **Flow**: The specific path or edge case
- **Type**: `e2e` (happy-path journey), `edge` (belongs to a journey), `smoke`, `integration`
- **Expected Result**: Specific, verifiable. Exact text/counts where possible.
- **Status**: `Ready` or `⚠️ OPEN — [question for user]`

#### Edge Case Discovery (Mandatory)

For EVERY journey, systematically sweep these categories. Do not skip any:

| Category | What to check |
|----------|--------------|
| Empty/zero states | First-time user, no data, zero amounts, empty lists |
| Boundary values | Max length inputs, special characters, Unicode/RTL, negative numbers |
| Permission boundaries | Wrong role attempts action, cross-tenant access, expired session |
| Error paths | Invalid input, duplicate submission, network failure, timeout |
| State transitions | Status changes, undo after save, back-button after submit |
| Concurrent/timing | Double-click submit, rapid navigation, stale data after tab switch |
| Data integrity | Persists after refresh, related records update, cascade delete |

Every edge case becomes a row in the test flow table. If you cannot determine the expected result, mark it ⚠️ OPEN.

#### ⚠️ OPEN QUESTION Flag (Non-Negotiable)

When the expected result for an edge case is ambiguous — you don't know if the system should reject or accept, show an error or silently ignore — **do NOT guess**. Mark it OPEN:

```
| T1.4 | CRUD Lifecycle | Submit form with future date | edge | ⚠️ OPEN — Allow future dates or reject? | Open |
```

**Rules:**
- The plan CANNOT be approved while any flow has ⚠️ OPEN status
- ALL open questions are presented to the user at Human Gate 2
- The user answers each one before the plan is approvable
- After the user answers, update the row with the confirmed expected result and set Status to Ready

This prevents the QA author from silently guessing edge case behaviors.

#### Test Components (for Deterministic Runner)

When building features, identify which **test components** (reusable eval sequences) exist and which need creation. This enables the deterministic runner to execute tests with zero LLM cost.

1. Call `get_components()` to see existing components for the project
2. For each test journey, identify which component methods are needed (e.g., `login.default`, `expense.create`, `navigation.sidebar_click`)
3. Add a "Components" column to the Test Journeys table showing which components each journey uses
4. Create a **Test Components to Create/Update** section listing:
   - New components needed (name, method, what they do)
   - Existing components that may need updates (because the feature changed UI they target)
   - Components at risk of breaking (because selectors/behavior changed)

This section is essential for the QA author — they will create components before writing tests, and compose tests from component calls instead of raw evals.

#### Negative Tests (per journey)
Explicitly list what must NOT happen:
- No console errors or white screens on any new route
- No data leakage across tenants/roles
- No silent failures (operation appears to succeed but data not persisted)

#### Framework Gotchas
Known pitfalls for the project's stack:
- Supabase: `.single()` vs `.maybeSingle()` for optional rows
- React: hydration mismatches, useEffect cleanup, stale closures
- RTL: explicit assertions for RTL alignment if the app uses RTL
- Dates: `toISOString()` is UTC — use local formatting for user-facing comparisons

### 6. Migration Files
If the plan requires database changes:
- Specify the migration file name (YYYYMMDDHHMMSS_description.sql)
- Write the SQL (idempotent — use IF NOT EXISTS, DO blocks)
- Note any data backfill or migration steps

## Quality Bar

A plan is ready when:
- [ ] A code agent can implement each phase without asking questions
- [ ] A QA author can write tests directly from the Test Journeys table — every journey, edge case, and expected result is defined
- [ ] **Zero ⚠️ OPEN questions remain** — all edge case behaviors confirmed by the user
- [ ] E2E test journeys are real multi-step user flows, not individual operations disguised as e2e
- [ ] Security considerations are specific (not generic OWASP checklists)
- [ ] Every phase has clear acceptance criteria
- [ ] Database migrations are idempotent
- [ ] No phase requires more than 3 files to change (break it down further if so)
