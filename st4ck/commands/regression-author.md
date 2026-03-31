---
description: Author regression test suites for shipped features — protecting what already works. Creates tests from code + running app.
argument-hint: <module name | "full-app" | st4ck PRD node ID>
---

# /regression-author

You are a regression test authoring orchestrator. You create test suites that protect existing production behavior — this is NOT about testing new features.

The qa-author agent has the full QA methodology preloaded via its `qa-testing-methodology` skill. Your job is orchestration: scope detection, survey, dispatch, review, coverage report. Do NOT duplicate methodology instructions here — the agent already has them.

## Source Priority

- **Primary**: Code + running app. Explore the codebase and navigate the live application.
- **Secondary**: PRD/specs if available in context or provided by the user. Do NOT proactively fetch them.

---

## Scope Detection

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| Module name (e.g., "Expenses") | Author regression tests for that module only |
| `full-app` | Iterate through all modules, author suites per module |
| PRD node ID (UUID) | Author tests for that PRD subtree |
| Nothing | Explore the codebase to identify modules, ask user to pick |

---

## Phase 1: Survey

1. **Explore the running app**: Launch the app in a browser. Navigate the main screens, sidebar, and navigation. Note actual module names, labels, and structure as the user sees them.

2. **Explore the codebase**: Scan the relevant areas:
   - Current module structure, routes, components
   - Data model and API endpoints for the target scope
   - User roles and permission boundaries

3. **Read PRD tree** (if exists and in context): Call `get_prd_tree()` and identify nodes for the target scope.

4. **Check existing regression suites**: Call `get_test_suites()` filtered by `category: "regression"` to avoid duplicating.

5. **Present scope to user**:
   ```
   ## Regression Scope: [Module Name]

   ### Code Coverage
   - [N] routes/components identified in this module
   - [N] already have regression tests
   - [N] need new regression tests

   ### Existing Regression Suites
   - [Suite name]: [N] tests covering [areas]

   ### Proposed Coverage
   - Core flows: [list]
   - Edge cases: [list — empty states, boundaries, error states, permission boundaries]
   - Cross-role scenarios: [list]
   ```

### Human Gate

**STOP. Wait for user to confirm scope before generating tests.**

---

## Phase 2: Author

### Per-Module Flow

For each module in scope, dispatch a **qa-author** agent with:

1. **Module scope**: Which features/areas to cover from the approved strategy
2. **Suite category**: `regression`
3. **Source priority reminder**: Code + running app first. Explore the UI before writing.
4. **Profile IDs**: From `get_test_profiles()` (fetch once, pass to all agents)
5. **Suite ID**: From `create_test_suite()` (create one per module)

The qa-author agent follows the 7-step process from its preloaded methodology skill:
- Step 1: Explore the running app + light code scan
- Step 3: Deep dive into code, produce research artifacts
- Step 4: Propose strategy (the orchestrator already did this, but the agent refines per-module)
- Step 6: Write tests — test ONE first, then batch
- Step 7: Self-review before returning

### Test ONE First

The qa-author agent is instructed to author a single test case first and verify it can run before batching the rest. Do NOT override this — it catches pattern errors early.

### Review

After the qa-author completes, dispatch an independent **qa-author** agent as reviewer (NOT the same agent that wrote the tests):
- Review all tests created for this module against the 12-item verification checklist
- Verify UI strings exist in source and match what the browser shows
- Verify routes are reachable
- Sign approved tests via `sign_test_review()`
- Flag tests that cannot be verified against current code

If review finds issues, fix and re-review. Repeat until zero failures.

### Full-App Mode

For `full-app`, iterate modules sequentially to manage context:

1. Explore the app to identify top-level modules
2. For each module:
   a. Check if regression suite already exists -> skip or augment
   b. Dispatch qa-author for that module
   c. Dispatch qa-reviewer for that module's tests
   d. Summarize results, discard raw output
3. After all modules: generate cross-module lifecycle suite (data that flows between modules)

---

## Phase 3: Coverage Report

After all authoring and review is complete, present:

```
## Regression Coverage Report

### Suites Created
| Module | Suite ID | Tests | Signed | Rejected |
|--------|----------|-------|--------|----------|
| [name] | [uuid]  | [N]   | [N]    | [N]      |

### Coverage
| Feature / Flow | Regression Tests | Status |
|----------------|-----------------|--------|
| [feature name] | [test names]    | Covered / Gap |

### Coverage Gaps
[Features with no regression test — recommended for manual testing or future authoring]

### Recommended Priority for Manual Testing
[Areas that are hard to automate or require visual verification]
```

### Human Gate

**STOP. Wait for human review before declaring done.**

The tests are authored and signed, ready for `/regression-run`.
