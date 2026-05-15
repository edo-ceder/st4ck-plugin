---
name: qa-testing-regression
description: Use this skill when the user wants to author regression tests that protect shipped behavior. Triggers on phrases like "create regression tests for", "protect this module", "regression coverage for", "add regression suite". You — the current session agent — are the authoring lead; you dispatch one `qa-author` per test journey + a fresh `qa-reviewer` per test for sign + `qa-runner` for execution.
---

# QA Testing — Regression Authoring Journey

**You — the current session agent — are the authoring lead.** Read the lead role-doc below; that's your orchestration playbook. You dispatch ONE leaf teammate role (`qa-author`, one per test journey) plus `qa-reviewer` (fresh instance per sign) and `qa-runner` (execution). You do NOT dispatch a sub-agent called "authoring-lead"; that's not a thing — you ARE the lead.

@${CLAUDE_PLUGIN_ROOT}/shared/authoring-lead-role.md

> **2026-05-02 surface notes (Plenty token-cost ship)** — affect every component you author through this skill:
> - **`save_and_sign(name, method, eval_sequence, ..., linked_execution_id)`** — composed verb. Use after a passing run to skip the three-call `save_component → review_component → sign_component_review` dance for self-reviewed flows. ~2× faster end-to-end.
> - **`validate_component(name, method, eval_sequence)`** — dry-run validator. Lints SELECTOR_QUALITY_RULE + primitive shape WITHOUT writing.
> - **OK/NF contract is server-enforced** — `evaluate` returning `"nf:..."` fails the action with `error.class="check_failed"` (runner alpha.13+, 2026-05-02). Author asserts as `return <verified> ? 'ok: <state proof>' : 'nf: <reason>'`. KB `9430ae8a` (updated) + KB `04e3cc28` (legacy class this closes).
> - **`wait_until kind: "js"` is now an alias for `kind: "custom"`** (runner alpha.12+).
> - **Sign-gate tolerates non-critical block failures** — `linked_execution_id` against `exec.status === "failed"` accepts when every critical block + the exercising block passed. KB `1dc73359`.
> - **Slim response shapes** on save / review / sign — full echoed component is gone. `get_component(name, method)` for full payload.

Regression tests protect shipped behavior — NOT new features (use `qa-testing-version` for in-development work).

## Phase 4 §4.2 — orchestration pattern

Regression authoring scales through per-journey fan-out: one `qa-author` per test journey in the approved scope (each drives a single Session, captures primitives, decomposes the trace into save_component(s) + create_test_case at the end), one fresh `qa-reviewer` per signed test, one `qa-runner` for execution. Teammates run in isolated context windows. Token target ≤10k per fresh test end-to-end. You coordinate via durable state (`dev_tasks`, `test_coverage_events`) and — in Team mode — `SendMessage` for live cross-talk.

Cross-test 5-rule decisions (§7.1 rules 2/3/5: ≥2 tests / ≥3 tests / ≥2 branching modes) happen at YOUR level: upfront via `get_component_discovery` before dispatch, and in a post-author **promotion sweep** (Step 7.5 below) after all qa-authors return. Per-test qa-author teammates handle rules 1+4 (closed interaction with post-state; modal/Radix) locally during the drive.

## Phase 5 §5.1 — intent_sources required

Every test you cause to be authored MUST land with `intent_sources` populated (≥1 entry). Pass enough context (PRD node IDs, spec section IDs, dev_task IDs, or a free-text description) into each `qa-author` dispatch so the teammate can set this. The reviewer's 13th attestation `intent_alignment` will block sign if intent_sources is empty or merely rubber-stamps current code.

## Common prelude — server is the single source of truth

- All QA rules live on the server in `backend/src/mcp/v3/methodology.ts`. Do NOT repeat rule text here — load it via `get_qa_methodology(section)`.
- Your `methodology_key` from `get_qa_methodology` has a 2-hour TTL. Re-fetch if expired.
- Teammate sub-agents (`qa-author`, `qa-reviewer`, `qa-runner`) fetch methodology themselves on dispatch — you don't pass it to them. You dispatch with context + intent; they load rules and attest server-side.

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

1. **Navigate the running app** — use `/st4ck:browse` or Playwright MCP to capture ACTUAL sidebar labels, button text, form fields, route structure. For no-code platforms (Bubble, etc.) this is the ONLY way to learn the UI.
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
3. **`get_component_discovery({intent_sources, module})`** — combines existing-tests / dev-plan / PRD / codebase signals to produce a **candidate-component list** with cross-test reuse pre-evaluated (§7.1 5-rule rules 2/3/5). The candidate list will be handed to each qa-author.
4. **Probe Agent Teams availability.** Try `Agent(subagent_type:'qa-author', ...)` with a no-op prompt + `SendMessage` to that teammate. If `SendMessage` returns successfully → **Team mode** (multi-turn teammates kept alive). If it errors → **sub-agent mode** (one-shot dispatch). Pick mode for the WHOLE orchestration.
5. **Pre-acquire profile + capture storageState** (recommended): `acquire_profile({role, environment_id})` once for the whole batch; drive a quick login session yourself; capture storageState to `.st4ck/state-<module>.json`. Pass `profile_id` + storageState path into each qa-author dispatch so teammates skip login.
6. **Pre-fetch + inject project context into the dispatch brief** (Ori e757fc2f, 2026-05-14). Sub-agents that fetch methodology + env_notes + components at startup pay ~50KB per spawn. Halve that by passing the data inline. Fetch once before dispatch:
   - `get_qa_methodology(section: "component_authoring")` — capture `data.key` AND `data.expires_at` (TTL is 24h now; one fetch covers the whole orchestration).
   - `get_test_environments()` — capture `qa_notes` for the env you're targeting.
   - `get_components({summary: true})` — server-side 5min cache means the call itself is cheap, but YOU still get the data once. Pass the slim catalog to each teammate so they don't re-call.

   Bake into each `qa-author` dispatch brief:
   ```
   Pre-loaded context (do NOT re-fetch):
   - methodology_key for component_authoring: <key> (expires <iso>)
   - env qa_notes: <text>
   - existing component catalog (slim): <JSON from get_components summary>
   - reference idiom: <component UUID from §5.6 bootstrap, if applicable>
   ```
   Teammates that ignore the pre-loaded context and re-fetch are over-billing the orchestration. If you see the same `get_qa_methodology` call from 3 different teammates in one orchestration, your dispatch brief isn't doing its job.

### Step 6 — Dispatch one qa-author per test journey

Per the lead role-doc above, you dispatch leaf teammates yourself. The team shape is:

- **One `qa-author` per test in the approved scope** (parallel via multiple `Agent` tool calls in one message — up to 5 concurrent).
- Each qa-author drives ONE Session against its journey, captures primitives, decomposes the trace into save_component(s) + create_test_case at the end. See `shared/qa-dispatch-contracts.md` for the dispatch template.
- Pass each teammate: the journey description, `intent_sources`, the candidate-component list (from Step 5), the existing component library, the pre-acquired `profile_id` + storageState path.

Intent: **regression**. Source priority: code + running app (not PRD/specs unless the user provided them).

### Step 7 — Validate teammate verdicts (mode-aware verdict recovery)

As each teammate returns:
- Suite ID set? Test IDs listed?
- Every core flow + edge case from the approved scope has at least one test?
- Every referenced component exists (`get_components()` cross-check)?
- Research artifact has `<sources_read>` with every cited file?

If a teammate returns `outcome: 'stuck'` (or truncates / returns ambiguous status), DO NOT reflexively spawn another sub-agent. **Try orchestrator-inline diagnosis FIRST** — read the failing execution's `structured_log` (`failed_only: true`), read 1–2 referenced components, reason inline about whether the failure is one layer deeper than the sub-agent reached. Budget ~20K tokens, 2–3 tool calls. See `shared/authoring-lead-role.md` § "Stuck-sub-agent recovery" for the full pattern + Ori K3 token math (15K inline beat 302K combined sub-agent attempts).

Only after the inline pass, route per the §5.7 escalation matrix. **For recoverable stucks where you have new info to share:**
- **Team mode**: `SendMessage` the same teammate with the new info.
- **Sub-agent mode**: Re-dispatch a fresh `qa-author` with original spec + new info appended.

### Step 7.5 — Promotion sweep (cross-test 5-rule decisions)

After all qa-authors return, scan returned `test_cases` for **inline primitive sub-sequences** that appear in ≥2 tests (§7.1 rules 2/3/5 — repeated patterns the per-test teammates couldn't evaluate alone).

For each repeated sequence:
- Author it as a proper component via `save_component` (TRIAD evidence: file:line + snapshot excerpt + KB result).
- For each test_case that contained the inline sequence: `modify_test_case` to replace the inline primitives with the new component call.

Typical regression contracts (5-15 tests) usually promote 2-5 components from the inline noise.

### Step 8 — Dispatch qa-reviewer (INDEPENDENT — must NOT be the author)

Use the `qa-reviewer dispatch contract` from `shared/qa-dispatch-contracts.md`. Always a fresh instance. Server hard-rejects signatures with `is_independent_reviewer: "no"`.

If review finds issues: re-dispatch the same `qa-author` (Team mode) or a fresh one (sub-agent mode) with reviewer's findings, then re-dispatch a fresh qa-reviewer. Loop until zero failures.

### Step 9 — Dispatch qa-runner (smoke + execution)

Once tests are signed, dispatch `qa-runner` with the test_case_ids + base_url + environment. The runner drives the `st4ck` brand CLI (`npx st4ck@latest run`), handles agentic-block IPC pauses inline (`{"op":"continue"}` over the runner's stdin; brief steps drive via `st4ck browse <op>` against the paused `session_name`), and returns per-test verdicts. Failures get auto-routed to `dev_tasks` per §5.5; the runner reports back, you summarize for the human.

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
