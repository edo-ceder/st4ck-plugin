---
name: qa-testing-regression
description: Use this skill when the user wants to author regression tests that protect shipped behavior. Triggers on phrases like "create regression tests for", "protect this module", "regression coverage for", "add regression suite". Per Phase 4 §4.2 the primary dispatch path is `authoring-lead` (Agent Teams pattern); single-agent `qa-author` is the backwards-compat fallback for one-component-scope tests.
---

# QA Testing — Regression Authoring Journey

You are orchestrating regression test authoring. Regression tests protect shipped behavior — NOT new features (use `qa-testing-version` for in-development work).

## Phase 4 §4.2 — primary dispatch is `authoring-lead`

Per the LLM-native platform plan, regression authoring scales through the **Agent Teams pattern**: this skill dispatches a single `authoring-lead` per scope, which then dispatches `component-author` and `test-author` teammates per candidate. Lead coordinates via durable state (`dev_tasks`, `test_coverage_events`); teammates run in isolated context windows. Token target ≤10k per fresh test end-to-end.

Use single-agent `qa-author` only as a fallback for tiny scopes (one component, one assertion) where the team split is overkill — see `qa-author.md`.

## Phase 5 §5.1 — intent_sources required

Every test you cause to be authored MUST land with `intent_sources` populated (≥1 entry). The `authoring-lead` derives intent from your dispatch prompt — pass enough context (PRD node IDs, spec section IDs, dev_task IDs, or a free-text description) for the lead to set this. The reviewer's 13th attestation `intent_alignment` will block sign if intent_sources is empty or merely rubber-stamps current code.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load it via `get_qa_methodology(section)`.
- Your `methodology_key` from `get_qa_methodology` has a 2-hour TTL. Re-fetch if expired.
- Sub-agents (`authoring-lead`, `component-author`, `test-author`, `qa-author`, `qa-reviewer`) fetch methodology themselves on dispatch — you don't pass it to them. You dispatch with context + intent; they load rules and attest server-side.

## Your journey

### Step 1 — Scope detection

From the user's request, classify the scope:

| Input signal | Action |
|---|---|
| Module name (e.g., "Expenses") | Regression suite for that module only |
| `full-app` | Iterate all modules, one suite each |
| PRD node ID (UUID) | Tests for that PRD subtree |
| Ambiguous | Explore the app and ask the user to pick |

### Step 2 — Explore the app + code (YOUR job, not the sub-agent's)

Regression authoring requires grounded understanding of what's shipped. You do this; the sub-agent starts at "deep dive into code."

1. **Navigate the running app** — use `agent-browser` or Playwright MCP. Capture ACTUAL sidebar labels, button text, form fields, route structure. For no-code platforms (Bubble, etc.) this is the ONLY way to learn the UI.
2. **Scan the codebase** — main routing file, sidebar/nav component, module boundaries (routes/components/data model/endpoints), user roles + permissions.
3. **Check existing coverage** — `get_test_suites(category: "regression")` to avoid duplication.
4. **Search the KB** — `search_test_knowledge(platform: "<platform>")` surfaces platform quirks (Bubble timing, React portal selectors, etc.). Pass results forward so the author doesn't re-discover solved problems. KB search is also one leg of the per-component triad (see methodology).

### Step 3 — Load methodology for the preparation you need

Call `get_qa_methodology(section: "process")` if you need the 7-step authoring model or the test-classification rules to form a proposal. You will NOT pass methodology text to the sub-agents — they fetch their own. But you may need rules to shape the proposal.

### Step 4 — Propose scope + depth, then HUMAN GATE

Present to the user:

```
## Regression Scope: [Module Name]

### What I found
- [N] routes/components in this module
- [N] already have regression tests
- [N] need new regression coverage

### Proposed coverage
- Core flows: [...]
- Edge cases: [...]
- Cross-role scenarios: [...]

### Depth: [standard — ~15 tests | shipping-ready — 20-40+ | quick sanity — 2-5]
```

**STOP. Wait for user to confirm scope before dispatching.**

### Step 5 — Prepare dispatch

1. `get_test_profiles()` — pass IDs/roles to the author.
2. `create_test_suite(name, category: "regression")` — pass the ID to the author.

### Step 6 — Dispatch qa-author

Compose the dispatch prompt using the `qa-author dispatch contract` template below. Fill the CONTEXT fields with your survey results; copy the INSTRUCTIONS block verbatim.

Intent: **regression**
Source priority: code + running app (not PRD/specs unless the user provided them)

Dispatch the sub-agent.

### Step 7 — Validate author output

When the sub-agent returns:
- Suite ID set? Test IDs listed?
- Every core flow + edge case from the approved scope has at least one test?
- Every referenced component exists (call `get_components()` and cross-check `{component, method}` usages)?
- Research artifact has `<sources_read>` with every cited file listed?

If gaps, re-dispatch with the specific missing rows.

### Step 8 — Dispatch qa-reviewer (INDEPENDENT)

Use the `qa-reviewer dispatch contract`. This MUST be a fresh sub-agent instance (different from the author). The server hard-rejects signatures with `is_independent_reviewer: "no"`.

If review finds issues: re-dispatch qa-author with the specific fixes, then re-dispatch qa-reviewer. Loop until zero failures.

### Step 9 — Coverage report + HUMAN GATE

Present:

```
## Regression Coverage Report

### Suites Created
| Module | Suite ID | Tests | Signed | Rejected |

### Coverage
| Feature / Flow | Regression Tests | Status |

### Gaps
[features with no test — recommended for manual testing or future authoring]
```

**STOP. Wait for human sign-off.**

### Step 10 — Handoff

Tests are signed and ready for `/st4ck:regression-run`. Tell the user the next command to run.

---

## Full-app mode (scope = `full-app`)

Iterate modules sequentially to manage context:

1. Explore the app to enumerate top-level modules.
2. For each module:
   a. Check if a regression suite exists → skip or augment.
   b. Run steps 2-9 above scoped to that module.
   c. Summarize + discard raw context before moving on.
3. After all modules: generate a cross-module lifecycle suite (data that flows between modules).

---

## Dispatch contracts

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
