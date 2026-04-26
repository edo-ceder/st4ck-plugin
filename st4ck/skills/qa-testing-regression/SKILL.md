---
name: qa-testing-regression
description: Use this skill when the user wants to author regression tests that protect shipped behavior. Triggers on phrases like "create regression tests for", "protect this module", "regression coverage for", "add regression suite". You — the current session agent — are the authoring lead; you dispatch component-author + test-author + qa-reviewer + qa-runner teammates directly. Single-agent qa-author is the fallback for one-component, one-assertion scopes.
---

# QA Testing — Regression Authoring Journey

**You — the current session agent — are the authoring lead.** Read the lead role-doc below; that's your orchestration playbook. You dispatch teammate sub-agents (`component-author`, `test-author`, `qa-reviewer`, `qa-runner`) — even a team of 1 if scope is small. You do NOT dispatch a sub-agent called "authoring-lead"; that's not a thing — you ARE the lead.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

Regression tests protect shipped behavior — NOT new features (use `qa-testing-version` for in-development work).

## Phase 4 §4.2 — Agent Teams pattern (you orchestrate)

Regression authoring scales through fan-out: one `component-author` per missing component, one `test-author` per test_case in the contract, one fresh `qa-reviewer` per signed test, one `qa-runner` for execution. Teammates run in isolated context windows. Token target ≤10k per fresh test end-to-end. You coordinate via durable state (`dev_tasks`, `test_coverage_events`) and `SendMessage` for live cross-talk.

Use single-agent `qa-author` only as a fallback for tiny scopes (one component, one assertion) where the team split is overkill — see `qa-author.md`.

## Phase 5 §5.1 — intent_sources required

Every test you cause to be authored MUST land with `intent_sources` populated (≥1 entry). Pass enough context (PRD node IDs, spec section IDs, dev_task IDs, or a free-text description) into each `test-author` dispatch so the teammate can set this. The reviewer's 13th attestation `intent_alignment` will block sign if intent_sources is empty or merely rubber-stamps current code.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load it via `get_qa_methodology(section)`.
- Your `methodology_key` from `get_qa_methodology` has a 2-hour TTL. Re-fetch if expired.
- Teammate sub-agents (`component-author`, `test-author`, `qa-author`, `qa-reviewer`, `qa-runner`) fetch methodology themselves on dispatch — you don't pass it to them. You dispatch with context + intent; they load rules and attest server-side.

## Your journey

### Step 0 — Load methodology BEFORE designing the contract

**HARD RULE.** Before you propose a regression scope, before you decompose the module into tests — call:

```
get_qa_methodology(section: "process")
get_qa_methodology(section: "block_format")
```

The "process" section contains the rule that most often gets missed at design time:

> **E2E TESTS ARE JOURNEYS, NOT INDIVIDUAL OPERATIONS.** An e2e test is a complete user journey: login, setup, action, verification. *"Create expense"* and *"Edit expense"* are NOT separate e2e tests — they are steps within a *"CRUD Lifecycle"* journey. Multi-block (3–8 blocks minimum) is required for `test_type='e2e'`.

Without this rule in mind, you will reflexively propose one test per acceptance criterion / per CRUD verb / per filter, and inflate the suite by 4–6×. Every AC under the same module / same admin page / same user role belongs in **one journey** as separate blocks, not separate tests.

The methodology_key returned by this call is also required by `create_test_case` later — load now, save the key, reuse on dispatch.

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

### Step 3 — (Methodology already loaded in Step 0 — skip)

If you skipped Step 0, go back. The "process" + "block_format" sections must be loaded before proposing the contract — not as a fallback for "if you need rules" but as a mandatory pre-condition. Methodology_key from Step 0 is reused here.

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

### Step 6 — Dispatch the team

Per the lead role-doc above, you dispatch leaf teammates yourself. Pick the shape:

- **Team-of-N (default for any non-trivial scope):** dispatch one `component-author` per missing component (run multiple in parallel via multiple `Agent` tool calls in one message), then dispatch one `test-author` per test_case. See `shared/qa-dispatch-contracts.md` for the templates.
- **Team-of-1 fallback (one component + one assertion only):** dispatch `qa-author` instead — combines discovery + component + test in one teammate. Use sparingly.

Common to both: include `intent_sources` in every CONTEXT. Intent: **regression**. Source priority: code + running app (not PRD/specs unless the user provided them).

### Step 7 — Validate teammate verdicts

As each teammate returns:
- Suite ID set? Test IDs listed?
- Every core flow + edge case from the approved scope has at least one test?
- Every referenced component exists (`get_components()` cross-check)?
- Research artifact has `<sources_read>` with every cited file?

If gaps, re-dispatch a fresh teammate with the specific missing rows.

### Step 8 — Dispatch qa-reviewer (INDEPENDENT — must NOT be the author)

Use the `qa-reviewer dispatch contract` from `shared/qa-dispatch-contracts.md`. Always a fresh instance — never the same teammate that authored the test. Server hard-rejects signatures with `is_independent_reviewer: "no"`.

If review finds issues: re-dispatch a fresh `test-author` (not the original) with the specific fixes, then re-dispatch a fresh `qa-reviewer`. Loop until zero failures.

### Step 9 — Dispatch qa-runner (smoke + execution)

Once tests are signed, dispatch `qa-runner` with the test_case_ids + base_url + environment. The runner drives the plugin's `run-test.js`, handles agentic-block pauses inline, and returns per-test verdicts. Failures get auto-routed to `dev_tasks` per §5.5; the runner reports back, you summarize for the human.

### Step 10 — Coverage report + HUMAN GATE

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
