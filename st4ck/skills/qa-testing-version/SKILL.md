---
name: qa-testing-version
description: Use this skill when the user wants to author version tests for in-development features — tests that go GREEN as implementation completes phase-by-phase. Triggers on phrases like "write tests for this feature", "version tests for this plan", "test coverage for this implementation", "author tests for the plan", or when `/implement` Track B is active. Pairs with TDD-style development plans.
---

# QA Testing — Version Authoring Journey

**You — the current session agent — are the authoring lead.** Read the lead role-doc below. You dispatch `qa-author` (one per journey) + fresh `qa-reviewer` (per sign) + `qa-runner` (execution). You do NOT dispatch "authoring-lead" — you ARE the lead.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

> **2026-05-02 surface notes (Plenty ship):** `save_and_sign(..., linked_execution_id)` — composed verb, ~2× faster, idempotent on `(content_hash, linked_execution_id, signed)`. `validate_component(...)` — dry-run lint without writing. **OK/NF contract server-enforced** — `evaluate` returning `"nf:..."` fails with `error.class="check_failed"` (alpha.13+); assert `return <verified> ? 'ok: <state proof>' : 'nf: <reason>'`. KB `9430ae8a` + `04e3cc28`. `wait_until kind: "js"` aliases `"custom"` (alpha.12+). Sign-gate tolerates non-critical failures (KB `1dc73359`). Slim responses on save/review/sign — use `get_component(name, method)` for full payload.

Version tests drive in-development work — written BEFORE implementation completes, start red, go green phase-by-phase as implementation lands.

## Phase 4 §4.6 + §4.7 — phase-gated signing

Same teammate set as regression. Difference: **when signing fires.**

- **Regression:** smoke passes at author time; sign immediately on pass.
- **Version:** authored as `draft` with `gates_on_plan_phase = <phase_id>`. Tests stay red until plan phase ships (`dev_task.status='shipped'` triggers auto-smoke per §4.7); on green → eligible for sign.

Pass `gates_on_plan_phase` in your dispatch to each `qa-author`.

## Phase 5 §5.1 — intent_sources REQUIRED

Every version test MUST land with `intent_sources` populated (≥1 entry). Natural intent: the dev plan's user-journey row + the dev_task it gates on. Reviewer's 13th attestation HARD-blocks sign if intent_sources is empty.

## Common prelude — server is the single source of truth

All QA rules live on the server in `methodology.ts`. DO NOT repeat rule text here — load via `get_qa_methodology(section)`. `methodology_key` TTL is 24h. Sub-agents fetch methodology themselves on dispatch.

## Key difference from regression

| | Regression | Version |
|---|---|---|
| Target | Shipped behavior | In-development feature |
| Source of truth | Code + running app | Plan's Journey table + spec (code is in flux) |
| Starting state | Green day 1 | Red, go green phase-by-phase |
| Coverage contract | "Protect what works" | "Implement every Ready row" |

## Your journey

### Step 0 — Load methodology BEFORE designing the contract

**HARD RULE.** Before proposing a coverage contract, before decomposing, before writing a single test row:

```
get_qa_methodology(section: "process")
get_qa_methodology(section: "block_format")
```

The `process` section contains the rule most often missed at design time:

> **E2E TESTS ARE JOURNEYS, NOT INDIVIDUAL OPERATIONS.** An e2e test is a complete user journey: login, setup, action, verification. *"Create expense"* and *"Edit expense"* are NOT separate e2e tests — they are steps within a *"CRUD Lifecycle"* journey. Multi-block (3–8 minimum) required for `test_type='e2e'`.

Propose without this rule loaded → reflexively map one AC to one test → inflate suite 4–6×. Every AC under the same admin page / same user role / same workflow belongs in **one journey** as separate blocks, not separate tests.

The methodology_key from this call is also required by `create_test_case` later — save it, reuse on dispatch.

### Step 1 — Scope detection

Authored from a plan: `/implement <plan-path>` (Track B), "write tests for X", or a pointer at a spec/PRD node. Identify the source. The **Journey table** is the authoring contract — every Status=Ready row MUST become a test.

### Step 2 — Load the plan + Journey table

Read the full plan. Extract: Requirements table, Journey table (coverage contract), acceptance criteria from linked spec sections, security considerations (version tests often need adversarial scenarios). No Journey table → STOP, tell user: "Plan needs a Journey table before version authoring; use `/dev-plan`."

### Step 3 — Explore survey context

Implementation is in flux; focus on what's stable: sidebar labels + navigation (usually stable from Phase 1); planned routes (may not exist yet — tests author against the plan's contract); platform + KB lookup via `search_test_knowledge(platform)`.

### Step 4 — Prepare dispatch

1. `get_test_profiles()` — pass IDs/roles forward.
2. `create_test_suite(name, category: "version")` — pass ID forward. Link to `version_id` if the project has an active version.

### Step 4.5 — Component discovery + mode probe (BEFORE dispatching)

1. **`get_component_discovery({intent_sources, module})`** — combines existing-tests / dev-plan / PRD / codebase → **candidate-component list** with cross-test reuse pre-evaluated (§7.1 rules 2/3/5).
2. **Probe Agent Teams.** Try `Agent(subagent_type:'qa-author', ...)` no-op + `SendMessage`. Success → **Team mode**; error → **sub-agent mode**. Pick ONE for the whole orchestration.
3. **Pre-acquire profile + storageState** (recommended): `acquire_profile({role, environment_id})` once for the batch; drive a quick login; capture to `.st4ck/state-<feature>.json`. Pass `profile_id` + storageState path to each dispatch so teammates skip login.

### Step 5 — Dispatch one qa-author per test journey

Per the lead role-doc, you dispatch leaf teammates yourself. Team shape:
- **One `qa-author` per Journey table row** (parallel via multiple `Agent` calls in one message — up to 5 concurrent, 8 with `ST4CK_MAX_CONTEXTS_PER_DAEMON`).
- Each qa-author drives ONE Session against its journey, captures primitives, decomposes the trace into save_component(s) + create_test_case. See `shared/qa-dispatch-contracts.md`.
- Pass each: journey description, `intent_sources`, `gates_on_plan_phase = <phase_id>`, candidate-component list (Step 4.5), existing library, `profile_id` + storageState.

### Step 6 — Validate teammate verdicts (mode-aware recovery)

Per returning teammate: every Ready row has a test? Every edge row covered? `get_components()` — every referenced component exists?

If a teammate returns `outcome: 'stuck'` (or ambiguous), **DO NOT reflexively spawn another sub-agent**. **Try orchestrator-inline diagnosis FIRST** — read failing execution's `structured_log` (`failed_only: true`), read 1–2 referenced components, reason inline. Budget ~20K tokens, 2–3 tool calls. See `shared/authoring-lead-role.md` § "Stuck-sub-agent recovery". Only after, route per §5.7. Recoverable stucks: **Team** → `SendMessage` same teammate; **sub-agent** → re-dispatch fresh `qa-author` with original spec + new info appended.

### Step 6.5 — Promotion sweep (cross-test 5-rule decisions)

After all qa-authors return, scan returned `test_cases` for **inline primitive sub-sequences** appearing in ≥2 tests (§7.1 rules 2/3/5). Per repeated sequence: author as a component via `save_component` (TRIAD: file:line + snapshot excerpt + KB result); `modify_test_case` each test_case to replace inlines with the component call. Typical contracts promote 2–5 components.

### Step 7 — Dispatch qa-reviewer (INDEPENDENT — MUST NOT be the author)

Use `qa-reviewer dispatch contract` from `shared/qa-dispatch-contracts.md`. Always a fresh instance. Server enforces independence at sign time. Review fails → re-dispatch same qa-author (Team) or fresh (sub-agent) with findings → re-dispatch fresh reviewer. Loop until signed.

### Step 8 — Dispatch qa-runner (smoke + execution)

Once signed, dispatch `qa-runner` with test_case_ids + base_url + environment. Runner drives `npx st4ck@latest run`, handles agentic IPC pauses inline (`{"op":"continue"}` over stdin; brief via `st4ck browse <op>` against paused `session_name`), returns per-test verdicts. Version tests born red wait until `dev_task.status='shipped'` flips eligibility — skip this step until then.

### Step 9 — Report back

If called from `/implement`, update the implement state file with suite ID + test IDs. Else present:

```
## Version Tests Authored: [feature]
- Suite ID: [uuid]
- Tests: [N] signed, [N] rejected
- Journey coverage: [N/N] rows implemented
- Edge cases added beyond plan: [list]
```

Tests now ready via `/st4ck:st4ck-run` or `/st4ck:regression-run`. They start red, go green phase-by-phase as implementation completes.

## TDD reminder

Version tests drive TDD — they exist BEFORE the feature. EXPECTED: authored tests fail immediately; go green phase-by-phase as `/implement` completes; all green → feature done. DO NOT author tests that "look passing" on day 1 — trivial OR the feature already existed (use regression).

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
