---
name: qa-testing-migration
description: Use this skill when the user wants to convert legacy agentic-format tests (`{action, expected}` blocks) to the deterministic component format (`{component, method, params}`). Triggers on phrases like "migrate these tests", "convert to component format", "move off agentic blocks", "modernize the test suite", "convert legacy tests". Creates missing components, rewrites blocks, human-gates each test before save.
---

# QA Testing — Migration Journey

You are converting legacy-format tests to the component-based deterministic format. The goal is executable-by-runner tests with zero agentic pauses unless genuine runtime decision-making is required.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load via `get_qa_methodology(section)`.
- Sub-agents fetch their own methodology on dispatch. You dispatch with intent = migration + scope = specific test IDs.
- `methodology_key` TTL 2 hours.

## Why migrate?

Legacy `{action, expected}` blocks require the sub-agent to reason at runtime — they are slow, token-expensive, and non-reproducible. Component-format blocks are deterministic: the runner (`run-test.js`) executes them with zero LLM calls. Migration is what moves a suite from "LLM-driven" to "scripted."

## Your journey

### Step 1 — Inventory

From the user's input (`$ARGUMENTS`):

| Input | Behavior |
|---|---|
| Suite ID (UUID) | Migrate all tests in that suite |
| Suite name | `get_test_suites` → find matching |
| Nothing | List suites containing legacy tests + ask user to pick |

Then:

```
get_test_cases(suite_id)     # list tests
get_components()             # existing components inventory
```

Classify each test:
- **Fully legacy** — every action is `{action, expected}`
- **Hybrid** — mix of legacy + component actions (migrate only the legacy ones)
- **Already component** — skip

### Step 2 — Present inventory + HUMAN GATE

```
## Migration Inventory: [Suite Name]

### Tests to migrate: [N] / [total]

| Test | Legacy blocks | Expected components to create |
|------|---------------|-------------------------------|
| [name] | [N] | [login.default, expense.create, ...] |

### Existing components to reuse: [list]
### Components to create: [estimated list]
### Tests to skip (already migrated): [N]

Proceed with migration?
```

**STOP. Wait for user confirmation.**

### Step 3 — Load the KB

```
search_test_knowledge(platform)
```

Platform quirks are load-bearing for migration — Bubble needs input waits, React portals need specific selectors, etc. Forward these lessons to the sub-agent.

### Step 4 — Dispatch qa-author (migration intent)

Use `qa-author dispatch contract`. Fill CONTEXT fields:
- **Intent:** migration
- **Scope:** the list of legacy test IDs (pass each verbatim)
- **Source priority:** existing legacy blocks + code (the blocks tell you the INTENT; the code tells you the real DOM)
- **Approved coverage:** not applicable — coverage is already defined by the existing tests. The contract is "preserve each test's intent, convert the form."
- Any human notes about specific blocks that MUST stay agentic (rare — user must justify)

Copy INSTRUCTIONS block verbatim.

Sub-agent will:
1. Read the legacy blocks
2. Search KB for platform quirks
3. `get_components()` to inventory reusable
4. For missing components: read actual source, test with agent-browser, complete CODE + SNAPSHOT + KB triad, `save_component`
5. Rewrite blocks: `{action, expected}` → `{component, method, params}`. Replace `profile_id` with `role`. Preserve `expected_outcome`.
6. **Challenge every action** — date pickers, edit dialogs, Radix dropdowns are ALL scriptable as components. Agentic blocks are a LAST RESORT only for genuine runtime decision-making (branching on unpredictable state, visual judgment, dynamic query construction).

### Step 5 — Per-test HUMAN GATE

For EACH migrated test, the sub-agent should NOT auto-save. Instead, it returns the migration proposal. You present:

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

Components created for this block: login.default (new)
Triad completeness: [✓ / missing leg — details]

Approve? [y / edit / skip]
```

**STOP per test. Wait for user.**

### Step 6 — Save approved migrations

After user approves each test:

```
modify_test_case(test_case_id, scenario_blocks: [...])
```

Server clears signatures automatically (block change = re-review required).

### Step 7 — Dispatch qa-reviewer (INDEPENDENT)

Use `qa-reviewer dispatch contract`. Reviewer ensures:
- Every new component passes SELECTOR QUALITY + TRIAD COMPLETENESS
- Test intent preserved (same behavior tested)
- Any remaining agentic blocks have genuine justification (`agentic_justification` attestation)

Re-dispatch author if issues. Loop until signed.

### Step 8 — Run migrated tests

Trigger `/st4ck:regression-run` or `/st4ck:st4ck-run` per test.

A migrated test should execute with **zero agentic pauses** unless you explicitly approved one. An agentic pause in a migrated test = migration is incomplete. Re-scope and re-migrate the offending block.

### Step 9 — Report

```
## Migration Complete: [Suite Name]

### Migrated: [N / total]
| Test | Components created | Agentic blocks remaining | Signed |

### New components in library
[list with triad completeness]

### Deferred agentic blocks
[blocks that must remain agentic — with human-approved justification]

### Follow-up
[any component that couldn't be built deterministically — KB lesson saved]
```

---

## Anti-patterns

- **Don't mark blocks agentic to skip work.** "Complex UI" is NOT valid justification. Edit dialogs, date pickers, Radix dropdowns are all scriptable.
- **Don't skip KB save.** Every new component pattern you figure out should become a KB entry. The next migration benefits.
- **Don't migrate without reading the legacy block carefully.** The legacy action text is the INTENT — preserve it. `modify_test_case` preserves `expected_outcome`; make sure the new block actually achieves that outcome.
- **Don't batch-save without per-test approval.** User gates every test. No exceptions.

---

## Dispatch contracts

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
