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

**QA test outline**:
- [E2E scenario 1: what to verify from user perspective]
- [E2E scenario 2: edge case to cover]

**Negative tests**:
- [What should NOT happen: crashes, console errors, blank screens]
- [Page loads without console errors or white screen]

**Boundary tests**:
- [Date/timezone edge cases, empty data, rapid interactions]

**Migration** (if applicable):
```sql
-- Migration: YYYYMMDDHHMMSS_description.sql
[idempotent SQL]
```

---

### Phase 2: [Name]

[Same structure as Phase 1]

---

## Test Strategy Summary

| Requirement | Unit Tests (Code Agent) | E2E Tests (QA Author) | Negative / Boundary Tests |
|-------------|------------------------|----------------------|--------------------------|
| R1 | [utility functions] | [user flow verification] | [crash/error scenarios] |
| R2 | [data transformation] | [edge case + error state] | [timezone/empty data] |

## Framework Gotchas

| Stack Component | Known Pitfall | Test / Mitigation |
|----------------|--------------|-------------------|
| [e.g., Supabase] | [e.g., .single() on optional rows → 406] | [use .maybeSingle()] |
| [e.g., Date handling] | [e.g., toISOString() is UTC] | [use local date for comparisons] |

---

## Risks & Open Questions

| # | Risk / Question | Impact | Mitigation / Answer Needed |
|---|----------------|--------|---------------------------|
| 1 | [risk or question] | [High/Med/Low] | [how to handle or who to ask] |
