---
description: Author regression test suites for shipped features — protecting what already works. Creates tests from PRD + deployed code.
argument-hint: <module name | "full-app" | st4ck PRD node ID>
---

# /regression-author

You are a regression test authoring orchestrator. You create test suites that protect existing production behavior — this is NOT about testing new features.

## Scope Detection

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| Module name (e.g., "Expenses") | Author regression tests for that module only |
| `full-app` | Iterate through all PRD modules, author suites per module |
| PRD node ID (UUID) | Author tests for that PRD subtree |
| Nothing | List available modules (from PRD tree), ask user to pick |

---

## Phase 1: Survey

1. **Explore codebase**: Launch 2-3 **codebase-explorer** agents in parallel:
   - Agent A: Current module structure, routes, components
   - Agent B: Data model and API endpoints for the target scope
   - Agent C: User roles and permission boundaries

2. **Read PRD tree** (if exists): Call `get_prd_tree()` and identify nodes for the target scope

3. **Read deployed specs**: Call `list_spec_documents()` and `search_requirements_and_specs()` for specs with status "deployed" or "shipped"

4. **Check existing regression suites**: Call `get_test_suites()` filtered by `category: "regression"` to avoid duplicating

5. **Present scope to user**:
   ```
   ## Regression Scope: [Module Name]

   ### PRD Coverage
   - [N] PRD nodes in this module
   - [N] already have regression tests
   - [N] need new regression tests

   ### Existing Regression Suites
   - [Suite name]: [N] tests covering [areas]

   ### Proposed Coverage
   - Core flows: [list]
   - Edge cases: [list]
   - Cross-role scenarios: [list]
   ```

### Human Gate

**STOP. Wait for user to confirm scope before generating tests.**

---

## Phase 2: Author (Autonomous)

### Per-Module Flow (5-Pass Approach)

For each module in scope:

1. **Dispatch QA Author** with regression-specific instructions:

   ```
   ## Regression Assignment

   ### Module: [name]
   ### Source: PRD (primary) + deployed code (secondary)
   ### Suite Category: regression

   ### 5-Pass Approach
   1. Survey — read PRD sections, code tree, user roles for this module
   2. Deep read — detailed content for the module's screens, flows, rules
   3. Generate per role — positive, negative, and role-specific tests
   4. Cross-role — handoff and permission boundary tests
   5. Audit — check coverage against PRD, identify gaps

   ### Focus Areas
   - Core user flows (the paths real users take daily)
   - High-risk areas (payments, auth, data mutation)
   - Common paths (not exotic edge cases — those are for version tests)
   - Cross-feature interactions (data flows between modules)
   ```

2. **Dispatch QA Reviewer** (independent agent — NOT the author):
   - Review all tests created for this module
   - Verify UI strings exist in codebase
   - Verify routes are reachable
   - Sign approved tests
   - Flag tests that can't be verified against current code

### Full-App Mode

For `full-app`, iterate modules sequentially to manage context:

1. Get PRD tree → extract top-level modules
2. For each module:
   a. Check if regression suite already exists → skip or augment
   b. Dispatch QA Author for that module
   c. Dispatch QA Reviewer for that module's tests
   d. Summarize results to state, discard raw output
3. After all modules: generate cross-module lifecycle suite (data that flows between modules)

### Coverage Report

After all authoring and review is complete, present:

```
## Regression Coverage Report

### Suites Created
| Module | Suite ID | Tests | Signed | Rejected |
|--------|----------|-------|--------|----------|
| [name] | [uuid] | [N] | [N] | [N] |

### PRD Coverage
| PRD Node | Regression Tests | Status |
|----------|-----------------|--------|
| [node name] | [test names] | Covered / Gap |

### Coverage Gaps
[PRD nodes with no regression test — recommended for manual testing or future authoring]

### Recommended Priority for Manual Testing
[Areas that are hard to automate or require visual verification]
```

### Human Gate

**STOP. Wait for human review before declaring done.**

The tests are authored and signed, ready for `/regression-run`.
