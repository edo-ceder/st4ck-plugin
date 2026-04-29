---
description: Execute a deterministic test case using the st4ck runner. Handles agentic block handoff via IPC pause and rerun from failure.
argument-hint: <test_case_id> [--env <environment_name>]
---

# /st4ck-run

You are an orchestrator for deterministic test execution. You invoke the runner, handle agentic-block IPC pauses inline, and report results.

## Runner shape

The runner is `@st4ck/runner` — Playwright-backed, IPC-pause for agentic handoff, deterministic replay for everything else. Invoke via `npx`:

```bash
npx st4ck-runner run <test_case_id> <base_url> \
  [--environment <env_name>] [--branch <name>] [--git-sha <sha>] \
  [--mode=qa] [--headless]
```

- `--mode=qa` (default) — runs signed tests; persists a `test_executions` row.
- Use `--mode=authoring` only for `/st4ck-author` flows where the test is unsigned and the run is ephemeral.
- `--continue <execution_id> --from-block <N>` — resume a prior run after handling an agentic block (see below).
- The runner reads `ST4CK_TOKEN` from env (Claude Code sets it from `.mcp.json` automatically). Don't pass it inline.

Recordings produced by `/st4ck-author` live at `.st4ck/recordings/<slug>.md` — pass the file path directly to `npx st4ck-runner run --test-file <path>` to replay them, no DB roundtrip.

## Resolution

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| UUID | Test case ID — run it directly |
| Test name | Search via `get_test_cases`, find matching test, use its ID |
| Nothing | Ask user which test to run |

## Pre-flight

1. Call `get_test_details(test_case_id)` to load the test.
2. Verify the test has `scenario_blocks` (not empty).
3. Check review signatures:
   - Component-format tests need `journey_signature` plus `review_signature` on every referenced component.
   - Legacy-format tests need `review_signature`.
4. Resolve the environment:
   - If `--env` provided, look up `test_environments` by name.
   - Otherwise use the first active environment for the project.

## Execute

```bash
npx st4ck-runner run <test_case_id> <base_url> \
  --environment <env_id> [--branch <name>] [--git-sha <sha>]
```

The runner stays alive across the whole test. Final exit codes are simple — no `42` because agentic pauses don't kill the process:

| Code | Meaning | Action |
|---|---|---|
| **0** | All blocks passed | Capture `execution_id` from the runner's final stdout envelope. |
| **1** | Failure | Read `mcp__st4ck-qa__get_execution_log(execution_id)` for `console_capture` + `network_failures` + the first failed action's error class. Report failure with evidence. |

## Agentic block handoff (IPC pause)

When the runner reaches an agentic block, it stays alive and emits an `agentic_pause` envelope to **stdout**, then waits for line-delimited JSON commands on **stdin**. You handle the work inline by sending primitives back over stdin until you send `{"op":"continue"}`; the runner then resumes the next block in the same browser context — no `--continue` needed, no `--from-block`, no storageState reload, page state preserved.

**Agentic blocks are a LAST RESORT.** They should only exist when the block requires runtime decision-making (branching on unpredictable state, visual judgment, or dynamic query construction). Date pickers, edit dialogs, and Radix dropdowns are scriptable as components — challenge any agentic block before executing it.

The pause envelope shape:

```json
{
  "type": "agentic_pause",
  "test_case_id": "...",
  "execution_id": "...",
  "block_index": 3,
  "brief": "Verify today's daily order...",
  "expected_outcome": "Order exists with submitted status and 1+ line items",
  "page_url": "https://...",
  "profile": { "id": "...", "email": "...", "role": "Customer" }
}
```

To drive the pause from a Claude Code Bash tool, spawn the runner with a stdin FIFO so you can send commands incrementally between observations — see [/st4ck:browse](st4ck-browse.md) for the canonical FIFO pattern (`mkfifo` + `run_in_background:true` + `BashOutput` + `echo … >&9`).

Your job during the pause:

1. Parse the pause envelope — `brief` is your primary instruction, `expected_outcome` is the verdict criterion.
2. Execute the brief by sending primitives over stdin:
   - **Frontend brief** — drive the same browser context with `{"op":"click"}`, `{"op":"fill"}`, `{"op":"snapshot"}`, etc. The page state at the pause moment is already loaded.
   - **Backend brief** — call `mcp__st4ck-dev__bubble_list_records` / `mcp__st4ck-dev__supabase_query` to verify data via the project's DB. Backend blocks are SELECT-only by default.
3. When the brief is satisfied, send `{"op":"continue"}` — the runner records the agentic block as passed and resumes.
4. If you cannot satisfy the brief, send `{"op":"abort","reason":"<short>"}` — the runner records the block as failed and exits.

## Rerun from failure

If a test failed at block N and the user wants to retry after a fix:

```bash
npx st4ck-runner run <test_case_id> <base_url> \
  --continue <execution_id> --from-block <N>
```

The runner loads the prior `test_executions` row's `structured_log`, skips already-passed blocks, and resumes at block N. Profile re-acquisition is automatic via `preferred_profile_id` from the prior log.

## Report

```
## Test Run: [test_name]

**Status**: PASSED / FAILED / ERROR
**Runner**: deterministic (zero LLM cost outside any agentic blocks)
**Duration**: [X]s
**Blocks**: [passed]/[total]

### Block Results
| # | Type | Description | Status | Duration |
|---|------|-------------|--------|----------|
| 0 | frontend | Login | passed | 2.1s |
| 1 | frontend | Navigate | passed | 0.8s |
| 2 | backend | Seed data | agentic (handled inline) | 1.2s |
| 3 | frontend | Verify | FAILED | 3.5s |

### Failure Details (if any)
- **Block 3, Action 1**: Verify condition timed out after 20s
- **DOM Snapshot**: [truncated snapshot]
- **Console Errors**: [any JS errors]

### Execution ID: [uuid]
Use `--continue <id> --from-block 3` to retry from the failed block.
```
