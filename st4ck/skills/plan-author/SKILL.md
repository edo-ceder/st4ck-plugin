---
name: plan-author
description: Create comprehensive implementation plans for features including phased tasks, security analysis, test strategy, and migration files. Use when transitioning from approved requirements to implementation.
---

# Plan Author

Create implementation plans that bridge requirements and code. A good plan lets a code agent implement without asking questions, and a QA author write tests without seeing the code.

## Plan Structure

Every plan follows the template at:
@${CLAUDE_PLUGIN_ROOT}/skills/plan-author/plan-template.md

## Planning Process

### 1. Understand Requirements
- Read the normalized requirements table.
- Read the codebase exploration findings.
- Identify what's new vs. extends existing features.

### 2. Technology Validation
New libraries / frameworks / patterns: verify stack compatibility, check known issues, prefer existing project dependencies over new ones.

### 3. Security Analysis
Per feature, consider: **auth** (required? which roles?), **authorization** (permission boundaries; can user A see user B's data?), **input validation** (where does user input enter? where validated?), **data exposure** (does any API return more than the UI needs?), **least privilege** (minimum permissions necessary?).

Document THIS feature's security, not generic OWASP categories.

### 4. Phase Breakdown
Phases must: be implementable + testable independently, depend only on earlier phases, have clear per-phase acceptance criteria, be small enough for one code-agent dispatch (~1–3 files per phase).

### 5. Test Strategy — Test Journeys & Edge Cases (CRITICAL)

The most important section. QA author implements exactly what you define here. Miss a flow → not tested. Wrong expected result → test verifies the wrong thing.

#### Unit Tests (per phase)
Specify pure functions + utilities for the code agent to unit-test.

#### Test Journeys (for QA Author)

**E2E tests are JOURNEYS, not individual operations.** A journey is a complete user flow: login → setup → action → verification. "Create expense" and "Delete expense" are NOT separate e2e tests — they are steps within an "Expense CRUD lifecycle" journey.

Smoke tests CAN be individual checks (1–2 blocks, shallow, fast gate). But any test typed `e2e` or `acceptance` MUST be a multi-step journey exercising a real user workflow end-to-end.

#### EVERY E2E Journey Creates Its Own Data (NON-NEGOTIABLE)

Every e2e journey MUST start with data creation steps via the UI. NO journey may assume pre-existing data — must work on a clean environment with only login credentials.

**Wrong:** `Switch tabs → filter by category → change month` (what data? fails on clean DB.)

**Right:** `Create 3 expenses (variable + fixed + commitment) → switch tabs → filter by category → change month → verify filters persist` (journey creates filterable data first, then exercises the feature).

If a journey tests filtering, it starts by creating filterable data. If deletion, it starts by creating something to delete. First steps of every e2e journey are setup — always via UI, NEVER SQL.

For every requirement, define test journeys with ALL edge cases:

```markdown
| ID | Journey | Flow | Type | Components | Expected Result | Status |
|----|---------|------|------|------------|-----------------|--------|
| T1 | Expense CRUD Lifecycle | Create via form → verify in list → edit amount → verify update → delete → verify gone | e2e | login.default, expense.create, expense.verify | Each step succeeds, list reflects changes, deletion removes from list+DB | Ready |
| T1.1 | Expense CRUD Lifecycle | Create with special chars (emoji, quotes) | edge | expense.create | Saved, displayed verbatim without encoding | Ready |
| T1.2 | Expense CRUD Lifecycle | Create with zero amount | edge | | ⚠️ OPEN — Reject or allow? | Open |
| T2 | Expense Filtering | Create 3 expenses (variable, fixed, commitment) → switch tabs → filter by category → change month → verify filters persist | e2e | login.default, expense.create, navigation.sidebar_click | Filters survive tab switch + month nav, correct data per filter | Ready |
| T3 | Access Control | Owner creates → switch to viewer → viewer sees but can't edit → viewer attempts create → blocked | e2e | login.default, expense.create | Viewer sees data, mutation UI hidden/disabled, direct API returns 403 | Ready |
| S1 | Smoke | Navigate to expenses page | smoke | navigation.sidebar_click | Page loads, list renders, zero console errors | Ready |
```

**Column rules:** **ID** `T[journey].[flow]` (e2e/edge), `S[n]` (smoke). **Journey** named, multiple flows share name. **Flow** specific path. **Type** e2e / edge / smoke / integration. **Components** what to create. **Expected Result** specific, verifiable, exact text/counts. **Status** Ready OR ⚠️ OPEN — [question].

#### Edge Case Discovery (MANDATORY)

For EVERY journey, systematically sweep — DO NOT skip any category: **Empty/zero states** (first-time user, no data, zero amounts, empty lists), **Boundary values** (max length, special chars, Unicode/RTL, negatives), **Permission boundaries** (wrong role, cross-tenant, expired session), **Error paths** (invalid input, duplicate submission, network failure, timeout), **State transitions** (status changes, undo after save, back-button after submit), **Concurrent/timing** (double-click submit, rapid nav, stale data after tab switch), **Data integrity** (persists after refresh, related records update, cascade delete). Every edge case = a row. Can't determine expected result → ⚠️ OPEN.

#### ⚠️ OPEN QUESTION Flag (NON-NEGOTIABLE)

Ambiguous expected result (you don't know if system should reject/accept, error/silently ignore) → **DO NOT guess**. Mark OPEN:

```
| T1.4 | CRUD Lifecycle | Submit form with future date | edge | expense.create | ⚠️ OPEN — Allow future dates or reject? | Open |
```

**Rules:** Plan CANNOT be approved while any flow has ⚠️ OPEN. ALL opens are presented to the user at Human Gate 2. User answers each one before approval. After answer, update row with confirmed result + Status=Ready.

Prevents the QA author from silently guessing edge case behaviors.

#### Test Components (for Deterministic Runner)

Identify reusable component methods enabling zero-LLM-cost execution:

1. `get_components()` for existing project components.
2. Per test journey, identify needed component methods (`login.default`, `expense.create`, `navigation.sidebar_click`).
3. Fill the "Components" column per journey.
4. Add a **Test Components to Create/Update** section: new components needed (name, method, purpose); existing components needing updates (because feature changed UI they target); components at risk of breaking (because selectors/behavior changed).

QA author creates components before writing tests, composes tests from component calls instead of raw evals.

#### Negative Tests (per journey)
Explicitly list what must NOT happen: no console errors / white screens on any new route; no data leakage across tenants/roles; no silent failures (operation appears to succeed but data not persisted).

#### Framework Gotchas
Stack-specific pitfalls: Supabase `.single()` vs `.maybeSingle()` for optional rows; React hydration mismatches + useEffect cleanup + stale closures; RTL explicit-alignment assertions if app uses RTL; dates `toISOString()` is UTC — use local formatting for user-facing comparisons.

### 6. Migration Files
DB changes: name `YYYYMMDDHHMMSS_description.sql`; write idempotent SQL (`IF NOT EXISTS`, `DO` blocks); note data backfill / migration steps.

### 7. Self-Review Until Convergence

After draft, review your own work. An independent agent then the human will review every section, cross-reference, task row, decision. Goal: a plan where an adversarial reviewer finds nothing. Each pass = full re-read, NOT spot-checking.

**Pass checklist (every pass):**

1. **Internal consistency** — Phase 2 mentions a table → does Phase 1 create it? Test journey references a component → is it in Components? Task targets a file → in Relevant Files?
2. **Integration paths complete** — Per new data format / API, trace through all layers (schema → handler → validation → DB → consumer). Every layer has a task?
3. **Cross-references survive edits** — Adding/moving a phase renumbers downstream. Task IDs, journey IDs, phase references still point right?
4. **Specificity** — Code agent implements each criterion without asking? QA author writes a test from each expected result without guessing?
5. **Displacement damage** — Did this pass's fixes break adjacent sections?

**Stopping condition:** last pass found nothing to change. Fixes displace other content → another pass required. NO cap on passes. DO NOT declare convergence prematurely. Skimming familiar text and saying "looks fine" is the single biggest source of plan defects. Slow down.

## Quality Bar

Ready when self-review converges (last pass found nothing) AND:
- [ ] Code agent can implement each phase without asking questions.
- [ ] QA author can write tests directly from the Test Journeys table — every journey + edge case + expected result defined.
- [ ] **Zero ⚠️ OPEN questions remain** — all edge case behaviors confirmed by user.
- [ ] E2E journeys are real multi-step user flows, not individual operations disguised as e2e.
- [ ] Security considerations are specific (not generic OWASP checklists).
- [ ] Every phase has clear acceptance criteria.
- [ ] DB migrations are idempotent.
- [ ] No phase requires > 3 files (break it down further if so).
- [ ] Context for Reviewers section filled (app summary, current/desired state, why).
