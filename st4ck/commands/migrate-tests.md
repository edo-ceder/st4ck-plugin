---
description: Migrate existing agentic test cases to the component-based format for deterministic execution. Human gate before saving.
argument-hint: <suite_id | suite_name>
---

# /migrate-tests

You convert existing legacy-format test cases (agentic `{action, expected}` blocks) to the component-based format (`{component, method, params}`) for deterministic execution.

## Resolution

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| UUID | Suite ID — migrate all tests in that suite |
| Suite name | Search via `get_test_suites`, find matching suite |
| Nothing | List suites with legacy tests, ask user to pick |

## Migration Process

### 1. Inventory

Call `get_test_cases(suite_id)` and `get_components()` to understand:
- How many tests have legacy-format blocks
- What components already exist
- What component gaps need filling

Present the inventory:
```
## Migration Inventory: [Suite Name]

Tests to migrate: [N] / [total]
Existing components: [list by name.method]
Components to create: [estimated — based on common patterns in the test actions]

Proceed with migration?
```

**STOP. Wait for user confirmation.**

### 2. Search Knowledge Base

Call `search_test_knowledge(platform: "<platform>")` to learn known quirks for this app's platform. Apply these lessons when creating components — e.g., Bubble needs extra waits after input fill, certain DOM elements render lazily. This prevents migration failures from platform-specific behavior.

### 3. Component Discovery

For each test, read the `scenario_blocks` and identify repeating patterns:
- Login flows → `login.default`
- Navigation patterns → `navigation.sidebar_click`, `navigation.tab_switch`
- CRUD operations → `[entity].create`, `[entity].edit`, `[entity].delete`
- Form interactions → `form.fill`, `form.submit`
- Verification patterns → `[entity].verify_in_list`, `[entity].verify_detail`

### 4. Create Missing Components

For each identified pattern:
1. **Read the actual source code** (JSX/TSX) to understand the DOM — parent/child hierarchy, data-testid attributes, class names, sibling elements. Grepping for a string is NOT sufficient. You must know the exact element and its context before writing a selector.
2. **Use specific selectors** — `data-testid` attributes, ID selectors, class-qualified tags (`h1.text-3xl`), or attribute selectors (`input[type="file"]`). Never bare tags like `querySelector('h1')` or `querySelector('button')`. The server rejects generic selectors at save time.
3. **Test interactively with agent-browser** before saving. Navigate to the page, run the eval step, inspect the DOM snapshot. If it works manually, script it. If it doesn't, fix it before saving — don't waste review/sign cycles on untested components.
4. Create the component via `save_component` with:
   - Proper `eval_sequence` (agent-browser evals)
   - `params_schema` for variable parts
   - `post_verify` for success confirmation
   - `selector_notes` citing source file:line for each targeted element

### 5. Rewrite Blocks

For each test case:
1. Map each legacy action to a component call
2. Add `role` to frontend blocks (replacing `profile_id`)
3. Preserve `expected_outcome` on each block
4. Challenge every action: can this be scripted as eval steps? Date pickers, edit dialogs, dropdowns — all scriptable. Only mark as agentic if the block requires runtime DECISION-MAKING (branching on unpredictable state, visual judgment). This should be extremely rare.

### 6. Human Gate

Present the migrated test side-by-side with the original:

```
## Test: [test_name]

### Block 1 (frontend)
BEFORE:
  profile_id: "abc-123"
  actions:
    1. { action: "Navigate to login page", expected: "Login form appears" }
    2. { action: "Enter email test@example.com", expected: "Email field filled" }
    3. { action: "Click 'Login'", expected: "Dashboard loads" }

AFTER:
  role: "admin"
  actions:
    1. { component: "login", method: "default", params: { role: "admin" } }
  expected_outcome: "User logged in to dashboard"

### Block 2 (frontend)
[... same format ...]

Approve this migration? [y/n/skip]
```

**For each test: STOP and wait for user approval before saving.**

### 7. Save

After user approves:
- Call `modify_test_case` with the new `scenario_blocks`
- Clear `review_signature` (migration = structural change requiring re-review)
- Note: `journey_signature` will be set after the reviewer signs the migrated test

## Rules

- Never auto-save without user approval
- Preserve the test's intent — the migrated version must test the same thing
- If a legacy action can't be mapped to an EXISTING component, CREATE a new component for it. Debug the interaction with agent-browser first, then script it. Marking as agentic is a last resort — only when runtime decision-making is genuinely required.
- Create components with good `selector_notes` so they're maintainable
- After migration, the test should be fully executable by `run-test.js` with zero agentic pauses. An agentic pause in a migrated test means the migration is incomplete.
