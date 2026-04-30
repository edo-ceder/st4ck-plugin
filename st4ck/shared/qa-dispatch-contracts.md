# QA Sub-Agent Dispatch Contracts

Shared dispatch prompt templates used by `qa-testing-regression`, `qa-testing-version`, and `qa-testing-migration`. **The current session agent enacts the authoring-lead role** (see `authoring-lead-role.md` in this directory) and dispatches these leaf teammate sub-agents:

- **`qa-author`** — primary authoring teammate. Drives one test journey end-to-end with primitives via `st4ck browse <op>` invocations, captures the trace via `--record`, decomposes into save_component(s) + create_test_case at the end.
- **`qa-reviewer`** — independent reviewer (always dispatched separately from author; server-enforced independence).
- **`qa-runner`** — executes signed tests via `npx st4ck@<version> run`; handles agentic-block IPC pauses inline using `st4ck browse <op>` against the paused session; returns per-test verdicts.

**No `authoring-lead` sub-agent.** The lead is a role the parent session enacts — not something you dispatch via the `Agent` tool. CC sub-agents are leaves and cannot recursively dispatch teammates. (Corrected 2026-04-26.)

**No separate `component-author` / `test-author` sub-agents** as of 2026-04-26. The per-test `qa-author` does its own component authoring during the drive (rules 1+4 of §7.1 5-rule self-checked locally; rules 2/3/5 evaluated by the orchestrator via `get_component_discovery` upfront + post-author promotion sweep). Earlier drafts split authoring into per-component + per-test sub-agents which created N-login friction with no architectural benefit.

**Why this file exists:** every authoring-flow skill dispatches the same set of teammate sub-agents with the same structural prompt. Keeping one copy here prevents drift between skills. Each skill fills CONTEXT fields specific to its intent; INSTRUCTIONS blocks are copied verbatim.

## Phase 5 §5.1 — `intent_sources` mandatory in every dispatch

EVERY `qa-author` dispatch MUST include `intent_sources` in the CONTEXT fields. The reviewer's 13th attestation `intent_alignment` hard-blocks sign on empty `intent_sources`. Free-text source_type is the always-available minimum:

```json
{
  "source_type": "free_text",
  "source_text": "<1-2 sentences describing what the test verifies — the spec, even when no PRD exists>",
  "source_id": null,
  "verified_by_reviewer": false
}
```

For projects with a PRD / specs / dev_tasks, prefer linking those instead of (or in addition to) free_text. Multiple entries are fine.

---

## qa-author dispatch contract

When dispatching the `qa-author` sub-agent (one per test journey), compose a prompt with these sections. The skill fills CONTEXT; INSTRUCTIONS go verbatim.

```
## Test Authoring Assignment — one journey

### Context (filled by dispatching skill — the lead role)

- **Intent:** [regression | version | migration]
- **Test journey description:** [what the user-visible behavior is + what should be true at the end. For migration: the legacy test's full scenario_blocks verbatim — that's your spec.]
- **Suite ID:** [uuid — create_test_suite was already called]
- **Suite Category:** [regression | version]
- **gates_on_plan_phase:** [phase_id — only for version intent]
- **Pre-acquired profile_id:** [uuid — the lead acquired one for the batch; use it to skip acquire_profile + avoid lock thrashing. If null, acquire your own.]
- **Storage state path:** [.st4ck/state-<feature>.json — captured by lead after one shared login. Pass to the runner via --browser-mode=rehydrate to skip login. If null, login during your drive.]
- **Profile role + properties:** [role + properties (used either for acquire OR validation that the pre-acquired profile matches)]
- **Intent sources:** [≥1 entry — REQUIRED. PRD node IDs, spec section IDs, dev_task IDs, or {source_type:'free_text', source_text:'...'}]
- **Existing component library:** [filtered get_components summary — what's already available]
- **Candidate-component list:** [from get_component_discovery — components the orchestrator pre-evaluated against §7.1 rules 2/3/5. If a captured sub-sequence matches a candidate, author it as a component.]
- **App URL / Base URL:** [url]
- **Platform:** [bubble | react | ...]
- **KB results (relevant subset):** [lessons from search_test_knowledge passed forward by the lead]

### INSTRUCTIONS (verbatim — do not paraphrase)

You drive ONE test journey end-to-end against the live app using the `st4ck browse` CLI's primitive surface. You don't call `agent-browser` directly, you don't call `st4ck-runner record` directly, you don't run `mkfifo` or manage FIFOs — the `st4ck browse` wrapper is the abstraction. You author components organically as you drive (the captured trace IS your verified work). At the end, you compose the test_case and return.

Your first actions MUST be in this order:
1. `get_qa_methodology(section: "block_format")` — keep `methodology_key` for `methodology_attestation` on `create_test_case`. 2-hour TTL.
2. `get_qa_methodology(section: "component_authoring")` — the canonical 5-rule + drive-and-decompose workflow + TRIAD requirement + size envelope. Same key.

Follow the workflow in your role-doc (`agents/qa-author.md`). Key non-negotiables the server enforces:

- Drive with primitives (`click`, `fill`, `wait_until`, `snapshot`, `evaluate`, `press`, `select`, `check_box`, `hover`, `upload`, plus the LLM-driven `check`, `see`, `extract`, `do`). Each is one Bash call: `npx st4ck@<version> browse <op> --session <slug> [flags]`. Never call `agent-browser` directly. Never call `st4ck-runner record` directly.
- Selector quality: never bare tags. For non-semantic elements use the wrapper's text-disambiguation subcommands `click-by-text` / `hover-by-text` / `type-by-text` with optional `--within-by role --within-value dialog`.
- Every new component must complete the CODE + SNAPSHOT + KB TRIAD in `selector_notes` before `save_component`. Missing any leg fails review.
- DATA REALISM: every specific value MUST exist for the profile at runtime. Verify via snapshot, project DB SELECT, or fixture-seeded.
- Block structure: ≤15 actions per block. `role` on component-format frontend blocks (not `profile_id`). Backend blocks SELECT-only. UI navigation after login — never direct URLs.
- Pre-sign smoke run is implicit — your drive IS the smoke. Capture the `execution_id` from your `--mode=qa` run (or by triggering qa-runner inline before returning) for the reviewer.

### Output

Per the verdict schema in `agents/qa-author.md` — outcome (success/stuck), test_case_id, components_authored, components_reused, evidence (with live_snapshot_proof for stuck verdicts), kb_entries_created.
```

---

## qa-reviewer dispatch contract

When dispatching the `qa-reviewer` sub-agent, compose a prompt with these sections. The reviewer MUST be a different sub-agent instance than the author (the server rejects signatures with `is_independent_reviewer: "no"`).

```
## Test Review Assignment

### Context (filled by dispatching skill)

- **Test case IDs to review (with passing execution_id each):** [{test_case_id, execution_id}, ...]
- **Suite ID:** [uuid]
- **Author sub-agent:** [was a separate instance — you did NOT author these]
- **Platform:** [bubble | react | ...]

### INSTRUCTIONS (verbatim — do not paraphrase)

Your first action MUST be `get_qa_methodology(section: "review")`. Keep the returned `methodology_key` — you will echo it in `review_test` and `sign_test_review` calls. 2-hour TTL.

Independence is non-negotiable. The server will hard-reject `sign_test_review` if `is_independent_reviewer: "no"`. If you somehow authored any of these tests, refuse and report back.

Every test handed to you MUST come with an `execution_id` from a passing run. Without it, `sign_test_review` will reject. If an entry is missing an execution_id, DO NOT attempt to sign — return "missing_execution_id" to the orchestrator; the author must re-run to green first.

Follow the review checklist you just fetched (the methodology's review section). For each test:

1. `review_test(test_case_id)` → returns the test body + `review_token`.
2. Run the checklist. Read source code for every UI string, route, column, and DOM selector cited. Grep before trusting.
3. For component-format tests: verify COMPONENT TRIAD COMPLETENESS on every referenced component (code + snapshot + KB). Missing any leg = reject. Verify component `eval_sequence` uses primitive shapes that the `st4ck browse` CLI / runner can dispatch — no raw `agent-browser` invocations, no `st4ck-runner record` calls baked into eval sequences, no FIFO manipulation.
4. For every data-mutating block: seed → verify seed → assert → cleanup pattern present.
5. `sign_test_review(test_case_id, review_token, review_attestation, execution_id)` when all checks pass. Attestation fields get cross-validated server-side against actual block content — do not attest falsely. The server also validates execution_id belongs to this test and has status="passed".

If any check fails, do NOT sign. Report specific failures to the orchestrator with file:line evidence.

### Output

For each test:
- **Verdict:** PASS / FAIL
- **Checklist result:** [X/N items passed]
- **Evidence:** file:line citations for everything you verified
- **Issues:** specific failures with evidence (if any)
- **Signed:** Yes / No (reason if No)

Plus coverage-gap analysis across the suite at the end.
```

---

## qa-runner dispatch contract

When dispatching the `qa-runner` sub-agent (after sign), use this template. The parent fills CONTEXT; INSTRUCTIONS go verbatim.

```
## QA Runner Assignment

### Context (filled by parent / authoring lead)

- **Test case IDs:** [uuid, uuid, ...]   (one or many — runner iterates)
- **Suite ID:** [uuid]                   (optional, if running a whole signed suite)
- **Base URL:** [staging URL]
- **Environment ID:** [uuid]             (must match a row in test_environments)
- **Branch / git SHA / PR:** [optional, for §4.7.1 attribution]
- **Headed?:** true|false                (default: headed)

### INSTRUCTIONS (verbatim — do not paraphrase)

You drive the `st4ck` brand binary for each test_case_id. Pre-flight: confirm each test is signed (`journey_signature` or `review_signature` non-null) — refuse unsigned tests with `stuck_kind: "unsigned_test"`. Invoke via Bash:

  npx st4ck@<version> run <test_case_id> <base_url> [--branch <name>] [--git-sha <sha>] [--environment <env_id>]

Substitute the latest `st4ck` version (`npm view st4ck version`); the plugin manifest does not pin the CLI, so the docs are the only signal.

Exit code policy: 0=pass, 1=fail (read execution log for diagnostics, ≤90 sec triage, move on). Agentic pauses do NOT exit the runner — handle them inline using `st4ck browse <op>` against the paused session per `qa-runner.md` rules, then send `{"op":"continue"}` to the runner's stdin to resume in the same browser context.

Safety limits: incremental write per test, ≤90 sec triage budget, 3-consecutive-same-signature bail, no retry on exit 1, retry-once-then-skip on infra error, 90-min wall-clock cap.

### Output

A verdict per the qa-runner schema in `agents/qa-runner.md` — array of per-test results + totals + stop_reason if any. Failures auto-route to dev_tasks via §5.5 server-side; you don't file them.
```

---

## How skills use this file

Each dispatching skill includes this file via:

```
@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
```

Then fills CONTEXT fields specific to its intent. The INSTRUCTIONS blocks are always copied verbatim — never paraphrase them, or sub-agents will drift.
