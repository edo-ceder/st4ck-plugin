# Implementation Plan: [Feature Name]

**Date**: [YYYY-MM-DD]
**Source**: [st4ck spec ID / file path / prompt summary]
**Status**: Draft

---

## Requirements

| ID | Requirement | Source | Acceptance Criteria |
|----|-------------|--------|---------------------|
| R1 | [description] | [source reference] | [specific, testable criteria] |
| R2 | [description] | [source reference] | [specific, testable criteria] |

---

## Codebase Context

### Relevant Files
| File | Relevance |
|------|-----------|
| [path] | [why this file matters for the implementation] |

### Patterns to Follow
- [Pattern 1: how similar things are done in this codebase]
- [Pattern 2: conventions to follow]

### Dependencies
- [Existing service/component that will be extended]
- [Library already in use that handles X]

---

## Security Considerations

| Area | Analysis | Mitigation |
|------|----------|------------|
| Authentication | [Who can access this feature?] | [How auth is enforced] |
| Authorization | [Permission boundaries?] | [RLS / middleware checks] |
| Input validation | [What user input?] | [Validation approach] |
| Data exposure | [What data is returned?] | [Field filtering / scoping] |

---

## Implementation Phases

### Phase 1: [Name]

**Goal**: [What this phase delivers]

**Tasks**:
| # | Task | File(s) | Acceptance Criteria |
|---|------|---------|---------------------|
| 1.1 | [task] | [path(s)] | [specific criteria] |
| 1.2 | [task] | [path(s)] | [specific criteria] |

**Unit tests**:
- [What pure functions / utilities to test]

**Migration** (if applicable):
```sql
-- Migration: YYYYMMDDHHMMSS_description.sql
[idempotent SQL]
```

---

### Phase 2: [Name]

[Same structure as Phase 1]

---

## Test Journeys (CRITICAL — QA Author Implements This Table)

E2E tests are **journeys**: complete user flows from login through verification. Individual operations (create, edit, delete) are steps within a journey, NOT separate e2e tests. Smoke tests CAN be individual checks.

**Every e2e journey creates its own data via the UI.** No journey may assume pre-existing data — it must pass on a clean environment with only login credentials. If the journey tests filtering, it starts by creating filterable data. If it tests deletion, it creates something to delete first. Always via UI, never SQL.

The QA author receives this table as a **contract** — they implement every row marked Ready and cannot drop planned flows. They may add discovered edge cases but must cover everything here first.

| ID | Journey | Flow | Type | Expected Result | Status |
|----|---------|------|------|-----------------|--------|
| T1 | [Journey Name] | [Create data via UI → action → verify → further action → verify] | e2e | [Specific expected outcome for each step] | Ready |
| T1.1 | [Journey Name] | [Edge case within journey] | edge | [Specific expected result] | Ready |
| T1.2 | [Journey Name] | [Ambiguous edge case] | edge | ⚠️ OPEN — [Question for user] | Open |
| T2 | [Journey Name] | [Create required data via UI → exercise feature → verify] | e2e | [Expected outcome] | Ready |
| T2.1 | [Journey Name] | [Permission boundary] | edge | [Expected result] | Ready |
| S1 | Smoke | [Quick gate check — no data setup needed] | smoke | [Page loads, zero console errors] | Ready |

**Column definitions:**
- **ID**: `T[journey].[flow]` for e2e/edge, `S[n]` for smoke
- **Journey**: Named journey. Edge cases share their parent journey name.
- **Flow**: The specific path being tested. E2E rows describe the full flow. Edge rows describe the variation.
- **Type**: `e2e` (happy-path journey), `edge` (variation within a journey), `smoke`, `integration`
- **Expected Result**: Specific, verifiable. Exact text, counts, state changes.
- **Status**: `Ready` (approved for authoring) or `⚠️ OPEN — [question]` (blocks plan approval)

### Negative Tests (per journey)
- [What must NOT happen: console errors, white screens, data leakage, silent failures]
- [Every new page/route: "loads without console errors or white screen"]

### Framework Gotchas

| Stack Component | Known Pitfall | Test / Mitigation |
|----------------|--------------|-------------------|
| [e.g., Supabase] | [e.g., .single() on optional rows → 406] | [use .maybeSingle()] |
| [e.g., Date handling] | [e.g., toISOString() is UTC] | [use local date for comparisons] |

---

## ⚠️ Open Questions

**The plan CANNOT be approved while any question remains unanswered.**

| # | Question | Context | Impact | Answer |
|---|----------|---------|--------|--------|
| 1 | [Edge case behavior question from Test Journeys table] | [Which flow this affects: T1.2] | [What happens if we guess wrong] | [User fills this in] |

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | [risk] | [High/Med/Low] | [how to handle] |
