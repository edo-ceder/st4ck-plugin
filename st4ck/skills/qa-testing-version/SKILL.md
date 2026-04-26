---
name: qa-testing-version
description: Use this skill when the user wants to author version tests for in-development features — tests that go GREEN as implementation completes phase-by-phase. Triggers on phrases like "write tests for this feature", "version tests for this plan", "test coverage for this implementation", "author tests for the plan", or when `/implement` Track B is active. Pairs with TDD-style development plans.
---

# QA Testing — Version Authoring Journey

**You — the current session agent — are the authoring lead.** Read the lead role-doc below; that's your orchestration playbook. You dispatch teammate sub-agents (`component-author`, `test-author`, `qa-reviewer`, `qa-runner`) — even a team of 1 if scope is small. You do NOT dispatch a sub-agent called "authoring-lead"; that's not a thing — you ARE the lead.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

Version tests drive in-development work — they are written BEFORE implementation completes, start red, and go green phase-by-phase as the implementation lands.

## Phase 4 §4.6 + §4.7 — phase-gated signing

Same teammate set (`component-author` + `test-author` → `qa-reviewer` → `qa-runner`) as regression. Difference is **when signing fires:**

- Regression: smoke must pass at author time; sign immediately on pass.
- Version: tests are authored as `draft` with `gates_on_plan_phase = <phase_id>` set. Tests stay red until the plan phase ships (`dev_task.status='shipped'` event triggers the auto-smoke per §4.7); on green, the test becomes eligible for sign.

Pass `gates_on_plan_phase` in your dispatch prompt to each `test-author` teammate so they set it on every authored test_case.

## Phase 5 §5.1 — intent_sources required

Every version test MUST land with `intent_sources` populated (≥1 entry). The natural intent for a version test is the dev plan's user-journey row + the dev_task it gates on. Pass these to the lead. Reviewer's 13th attestation will hard-block sign if intent_sources is empty.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load it via `get_qa_methodology(section)`.
- `methodology_key` TTL is 2 hours. Re-fetch if expired.
- Sub-agents fetch methodology themselves on dispatch. You pass CONTEXT + intent; they load rules.

## Key difference from regression

| | Regression | Version |
|---|---|---|
| Target | Shipped behavior | In-development feature |
| Source of truth | Code + running app | Plan's Journey table + spec (code is in flux) |
| Starting state | Tests go green on day 1 | Tests start red, go green phase-by-phase |
| Coverage contract | "Protect what works" | "Implement every Ready row" |

## Your journey

### Step 0 — Load methodology BEFORE designing the contract

**HARD RULE.** Before you propose a coverage contract, before you decompose the spec, before you write a single test row — call:

```
get_qa_methodology(section: "process")
get_qa_methodology(section: "block_format")
```

The "process" section contains the rule that most often gets missed at design time:

> **E2E TESTS ARE JOURNEYS, NOT INDIVIDUAL OPERATIONS.** An e2e test is a complete user journey: login, setup, action, verification. *"Create expense"* and *"Edit expense"* are NOT separate e2e tests — they are steps within a *"CRUD Lifecycle"* journey. Multi-block (3–8 blocks minimum) is required for `test_type='e2e'`.

If you propose without this rule loaded, you will reflexively map one acceptance criterion to one test and inflate the suite by 4–6×. Every AC under the same admin page / same user role / same workflow belongs in **one journey** as separate blocks, not separate tests.

The methodology_key returned by this call is also required by `create_test_case` later — load now, save the key, reuse on dispatch.

### Step 1 — Scope detection

Version tests are authored from a plan. The user either:
- Invoked `/implement <plan-path>` (Track B of the implement flow triggers this skill)
- Said "write tests for [plan or feature]"
- Pointed at a spec document or a PRD node

Identify the source. The **Journey table** in the plan (or its equivalent in the spec) is the authoring contract — every row with Status=Ready MUST become a test.

### Step 2 — Load the plan + Journey table

Read the full plan. Extract:
- Requirements table
- Journey table (the coverage contract)
- Acceptance criteria from linked spec sections (if any)
- Security considerations (version tests often need adversarial scenarios)

If no Journey table exists, STOP — the plan is not ready for authoring. Tell the user: "the plan needs a Journey table before version authoring; use /dev-plan to add one."

### Step 3 — Explore survey context

Since the implementation is in flux, your survey focuses on what's stable:
- Sidebar labels and navigation structure (usually stable from Phase 1)
- Routes planned in the requirements (may not all exist yet — that's fine, tests author against the plan's contract)
- Platform + KB lookup: `search_test_knowledge(platform)`

### Step 4 — Prepare dispatch

1. `get_test_profiles()` — pass IDs/roles forward.
2. `create_test_suite(name, category: "version")` — pass the ID forward. Link to `version_id` if the project has an active version.

### Step 5 — Dispatch the team

Per the lead role-doc above, you dispatch leaf teammates yourself (you are the lead). Pick the right shape for the scope:

- **Team-of-N (default for >1 component or >2 tests):** dispatch one `component-author` per missing component (in parallel where possible — multiple Agent tool calls in one message), then dispatch one `test-author` per test_case in the contract. See `shared/qa-dispatch-contracts.md` for the dispatch templates.
- **Team-of-1 fallback (single component + single assertion only):** dispatch `qa-author` instead — it does discovery + component + test in one teammate. Use sparingly.

Common to both: include `intent_sources` + `gates_on_plan_phase = <phase_id>` in every dispatch CONTEXT.

### Step 6 — Validate teammate verdicts

As each teammate returns:
- Every Status=Ready row in the Journey table has a corresponding test?
- Every edge row covered?
- Any additional edge cases the author discovered during code reading beyond the plan?
- `get_components()` — every referenced component exists?

If gaps, re-dispatch a fresh teammate with the specific missing rows.

### Step 7 — Dispatch qa-reviewer (INDEPENDENT — must NOT be the author)

Use `qa-reviewer dispatch contract` from `shared/qa-dispatch-contracts.md`. Always a fresh instance. Server enforces independence at sign time.

Re-dispatch a fresh `test-author` (not the original) if review fails with findings. Loop reviewer ↔ author until signed.

### Step 8 — Dispatch qa-runner (smoke + execution)

Once tests are signed, dispatch `qa-runner` with the test_case_ids + base_url + environment. The runner drives the plugin's `run-test.js`, handles agentic-block pauses, and returns per-test verdicts. For version tests born red (waiting on phase-gated signing), skip this step until `dev_task.status='shipped'` flips the test to eligible.

### Step 9 — Report back to orchestrator (or user)

If called from `/implement`, update the implement state file with suite ID + test IDs. Otherwise present:

```
## Version Tests Authored: [feature name]

- Suite ID: [uuid]
- Tests: [N] signed, [N] rejected
- Journey coverage: [N/N] rows from plan implemented
- Edge cases added beyond plan: [list]
```

Tests are now ready to run via `/st4ck:st4ck-run` or `/st4ck:regression-run`. They will start red and go green phase-by-phase as implementation completes.

---

## TDD flow reminder

Version tests drive TDD — they exist BEFORE the feature they test. It is EXPECTED that:
- Authored tests fail immediately when run (the feature isn't built yet).
- Tests go green phase-by-phase as `/implement` completes each phase.
- When all tests green → the feature is done.

Do NOT author tests that "look passing" on day 1. If they pass on day 1, they are probably asserting something trivial, or the feature already existed (use regression instead).

---

## Dispatch contracts

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
