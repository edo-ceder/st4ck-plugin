---
name: qa-testing-regression
description: Use this skill when the user wants to author regression tests that protect shipped behavior. Triggers on phrases like "create regression tests for", "protect this module", "regression coverage for", "add regression suite". You — the current session agent — are the authoring lead; you dispatch one `qa-author` per test journey + a fresh `qa-reviewer` per test for sign + `qa-runner` for execution.
---

# QA Testing — Regression Authoring Journey

**You — the current session agent — are the authoring lead.** Read the lead role-doc below. You dispatch `qa-author` (one per journey) + fresh `qa-reviewer` (per sign) + `qa-runner` (execution). You do NOT dispatch "authoring-lead" — you ARE the lead.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

> **2026-05-02 surface notes (Plenty ship):** `save_and_sign(..., linked_execution_id)` — composed verb, ~2× faster, idempotent on `(content_hash, linked_execution_id, signed)`. `validate_component(...)` — dry-run lint without writing. **OK/NF contract server-enforced** — `evaluate` returning `"nf:..."` fails with `error.class="check_failed"` (alpha.13+); assert `return <verified> ? 'ok: <state proof>' : 'nf: <reason>'`. KB `9430ae8a` + `04e3cc28`. `wait_until kind: "js"` aliases `"custom"` (alpha.12+). Sign-gate tolerates non-critical failures (KB `1dc73359`). Slim responses on save/review/sign — use `get_component(name, method)` for full payload.

Regression tests protect shipped behavior — NOT new features (use `qa-testing-version` for in-development work).

## Phase 4 §4.2 — orchestration pattern

Per-journey fan-out: one `qa-author` per test journey (drives a Session, captures primitives, decomposes the trace into save_component(s) + create_test_case), one fresh `qa-reviewer` per signed test, one `qa-runner` for execution. Teammates run in isolated context windows; token target ≤10k per fresh test end-to-end. Coordinate via durable state (`dev_tasks`, `test_coverage_events`) and — in Team mode — `SendMessage`.

Cross-test 5-rule decisions (§7.1 rules 2/3/5: ≥2 tests / ≥3 tests / ≥2 branching modes) happen at YOUR level: upfront via `get_component_discovery` before dispatch, and in a post-author **promotion sweep** (Step 7.5). Per-test teammates handle rules 1+4 (closed interaction with post-state; modal/Radix) locally.

## Phase 5 §5.1 — intent_sources REQUIRED

Every test you cause to be authored MUST land with `intent_sources` populated (≥1 entry). Pass enough context (PRD node IDs, spec section IDs, dev_task IDs, or free-text description) into each `qa-author` dispatch so the teammate sets this. Reviewer's 13th attestation `intent_alignment` HARD-blocks sign if intent_sources is empty or merely rubber-stamps current code.

## Common prelude — server is the single source of truth

QA rules live on the server in `methodology.ts`. DO NOT repeat rule text here — load via `get_qa_methodology(section)`. `methodology_key` TTL 24h. Teammates fetch methodology themselves on dispatch — you don't pass it. Dispatch with context + intent; they load rules and attest server-side.

## Your journey

### Step 0 — Load methodology BEFORE designing the contract

**HARD RULE.** Before proposing regression scope, before decomposing the module:

```
get_qa_methodology(section: "process")
get_qa_methodology(section: "block_format")
```

The `process` section contains the rule most often missed at design time:

> **E2E TESTS ARE JOURNEYS, NOT INDIVIDUAL OPERATIONS.** An e2e test is a complete user journey: login, setup, action, verification. *"Create expense"* and *"Edit expense"* are NOT separate e2e tests — they are steps within a *"CRUD Lifecycle"* journey. Multi-block (3–8 minimum) required for `test_type='e2e'`.

Without this rule loaded, you reflexively propose one test per AC / per CRUD verb / per filter and inflate the suite 4–6×. Every AC under the same module / admin page / user role belongs in **one journey** as separate blocks, not separate tests.

The methodology_key from this call is required by `create_test_case` later — save it, reuse on dispatch.

### Step 1 — Scope detection

| Input signal | Action |
|---|---|
| Module name (e.g., "Expenses") | Regression suite for that module |
| `full-app` | Iterate all modules, one suite each |
| PRD node ID (UUID) | Tests for that PRD subtree |
| Ambiguous | Explore + ask the user to pick |

### Step 2 — Explore the app + code (YOUR job)

Regression authoring requires grounded understanding of what's shipped:

1. **Navigate the running app** — `/st4ck:browse` or Playwright MCP for ACTUAL sidebar labels, button text, form fields, routes. For no-code platforms (Bubble, etc.) this is the ONLY way.
2. **Scan the codebase** — main routing, sidebar/nav, module boundaries (routes/components/data model/endpoints), user roles + permissions.
3. **Check existing coverage** — `get_test_suites(category: "regression")` to avoid duplication.
4. **Search the KB** — `search_test_knowledge(platform: "<platform>")`. Pass results forward so the author doesn't re-discover. KB is one leg of the per-component triad.

### Step 3 — Skip (methodology already loaded in Step 0)

### Step 4 — Propose scope + depth, then HUMAN GATE

```
## Regression Scope: [Module Name]
### What I found
- [N] routes/components / [N] already covered / [N] need coverage
### Proposed coverage
- Core flows / Edge cases / Cross-role scenarios
### Depth: [standard — ~15 tests | shipping-ready — 20-40+ | quick sanity — 2-5]
```

**STOP. Wait for user confirmation before dispatching.**

### Step 5 — Prepare dispatch

1. `get_test_profiles()` — pass IDs/roles to authors.
2. `create_test_suite(name, category: "regression")` — pass ID to authors.
3. **`get_component_discovery({intent_sources, module})`** — candidate-component list with cross-test reuse pre-evaluated (§7.1 rules 2/3/5).
4. **Probe Agent Teams.** `Agent(subagent_type:'qa-author', ...)` no-op + `SendMessage`. Success → **Team mode**; error → **sub-agent mode**. Pick ONE for the whole orchestration.
5. **Pre-acquire profile + storageState** (recommended): `acquire_profile({role, environment_id})` once for the batch; capture storageState to `.st4ck/state-<module>.json`. Pass `profile_id` + path to each dispatch.
6. **Pre-fetch + inject project context into the dispatch brief** (Ori e757fc2f, 2026-05-14). Halve sub-agent startup tokens. Call ONCE: `get_qa_methodology(section: "component_authoring")` → key + expires_at (24h); `get_test_environments()` → qa_notes; `get_components({summary: true})` → slim catalog. Inject into each qa-author brief — teammates that re-fetch over-bill by ~50KB per spawn.

### Step 6 — Dispatch one qa-author per test journey

Per the lead role-doc, you dispatch leaf teammates yourself. Team shape:
- One `qa-author` per test in approved scope (parallel via multiple `Agent` calls in one message — up to 5 concurrent).
- Each drives ONE Session against its journey, captures primitives, decomposes the trace. See `shared/qa-dispatch-contracts.md`.
- Pass each: journey description, `intent_sources`, candidate-component list (Step 5), existing library, `profile_id` + storageState path.

Intent: **regression**. Source priority: code + running app (not PRD/specs unless user provided them).

### Step 7 — Validate teammate verdicts (mode-aware recovery)

Per returning teammate: Suite ID set? Test IDs listed? Every core flow + edge case has at least one test? Every referenced component exists (`get_components()`)? Research artifact has `<sources_read>` with every cited file?

If a teammate returns `outcome: 'stuck'` (or ambiguous), **DO NOT reflexively spawn another sub-agent**. **Try orchestrator-inline diagnosis FIRST** — read failing execution's `structured_log` (`failed_only: true`), read 1–2 referenced components, reason inline. Budget ~20K tokens, 2–3 tool calls. See `shared/authoring-lead-role.md` § "Stuck-sub-agent recovery" (Ori K3: 15K inline beat 302K combined sub-agent attempts). Only after inline pass, route per §5.7. Recoverable stucks: **Team** → `SendMessage`; **sub-agent** → re-dispatch fresh.

### Step 7.5 — Promotion sweep (cross-test 5-rule decisions)

After all qa-authors return, scan returned `test_cases` for **inline primitive sub-sequences** appearing in ≥2 tests (§7.1 rules 2/3/5). Per repeated sequence: `save_component` (TRIAD: file:line + snapshot excerpt + KB result); `modify_test_case` each to replace the inline with the new component call. Typical regression contracts (5–15 tests) promote 2–5 components.

### Step 8 — Dispatch qa-reviewer (INDEPENDENT — MUST NOT be the author)

Use `qa-reviewer dispatch contract` from `shared/qa-dispatch-contracts.md`. Always a fresh instance. Server HARD-rejects signatures with `is_independent_reviewer: "no"`. Review fails → re-dispatch same qa-author (Team) or fresh (sub-agent) with findings → fresh reviewer. Loop until zero failures.

### Step 9 — Dispatch qa-runner (smoke + execution)

Once signed, dispatch `qa-runner` with test_case_ids + base_url + environment. Runner drives `npx st4ck@latest run`, handles agentic IPC pauses inline (`{"op":"continue"}` over stdin; brief via `st4ck browse <op>` against paused `session_name`). Failures auto-route to `dev_tasks` per §5.5.

### Step 10 — Coverage report + HUMAN GATE

```
## Regression Coverage Report
### Suites Created
| Module | Suite ID | Tests | Signed | Rejected |
### Coverage
| Feature / Flow | Regression Tests | Status |
### Gaps
[features with no test — recommended for manual or future authoring]
```

**STOP. Wait for human sign-off.** Then tell the user: next command is `/st4ck:regression-run`.

---

## Full-app mode (scope = `full-app`)

Iterate modules sequentially: enumerate top-level modules → per module: check existing suite → run steps 2–9 scoped → summarize + discard raw context. After all: generate a cross-module lifecycle suite for data flowing between modules.

---

@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
