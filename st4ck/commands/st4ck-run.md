---
description: Execute a deterministic test case using the st4ck runner. Handles agentic block handoff via IPC pause and rerun from failure.
argument-hint: <test_case_id> [--env <environment_name>]
---

# /st4ck-run

You are an orchestrator for deterministic test execution. You invoke the runner, handle agentic-block IPC pauses inline, and report results.

## Runner shape

The runner sits behind the `st4ck` brand binary. You drive it via `npx st4ck@latest run` — the wrapper resolves the underlying runner on your behalf. Playwright-backed, IPC-pause for agentic handoff, deterministic replay for everything else.

```bash
npx st4ck@latest run <test_case_id> <base_url> \
  [--environment <env_name>] [--branch <name>] [--git-sha <sha>] \
  [--mode=qa] [--headless]
```

> **Version.** `@latest` resolves to the current release. To pin (CI reproducibility, rollback), substitute an explicit version (e.g. `npx st4ck@0.2.0-alpha.1`); see `npm view st4ck versions` for the list. The plugin manifest schema has no version-pinning field.

- `--mode=qa` (default) — runs signed tests; persists a `test_executions` row.
- Use `--mode=authoring` only for `/st4ck-author` flows where the test is unsigned and the run is ephemeral.
- `--continue <execution_id> --from-block <N>` — resume a prior run after handling an agentic block (see below).
- **Browser-context emulation flags** (`--device`, `--viewport`, `--locale`, `--timezone-id`, `--color-scheme`, `--reduced-motion`, `--forced-colors`, `--geolocation`, `--permissions`, `--http-credentials`, `--offline`, `--bypass-csp`, `--context-options '<json>'`) are accepted on replay too — pass them when a test should run against a non-default Playwright context (mobile emulation, locale-aware app, etc.). Full table + merge precedence: [/st4ck:browse](st4ck-browse.md#browser-context-emulation-flags). Same surface for record and replay.
- The runner needs an MCP auth token for test-by-id mode (file-replay mode does NOT). The `st4ck` CLI wrapper resolves it in three tiers: (1) `ST4CK_TOKEN` env var if set, (2) auto-recovered from `.mcp.json` / `~/.claude.json` / `~/.claude/.mcp.json` (looks for any `mcpServers.st4ck-*` entry with `?apiKey=<token>` in the URL — added in `st4ck@0.2.0-alpha.16`, 2026-05-07), (3) hard error pointing at st4ck Project Settings → Integrations. Don't pass tokens inline — that leaks them in process listings.

Recordings produced by `/st4ck-author` (or by `/st4ck:browse launch --record`) live at `.st4ck/recordings/<slug>.md` — pass the file path directly to `npx st4ck@latest run <path>` to replay them, no DB roundtrip.

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
npx st4ck@latest run <test_case_id> <base_url> \
  --environment <env_id> [--branch <name>] [--git-sha <sha>]
```

The runner stays alive across the whole test. Final exit codes are simple — no `42` because agentic pauses don't kill the process:

| Code | Meaning | Action |
|---|---|---|
| **0** | All blocks passed | Capture `execution_id` from the runner's final stdout envelope. |
| **1** | Failure | Read `mcp__st4ck-qa__get_execution_log(execution_id)` for `console_capture` + `network_failures` + the first failed action's error class. Report failure with evidence. |

## Agentic block handoff (IPC pause)

When the runner reaches an agentic block, it stays alive and emits an `agentic_pause` envelope on **stdout**, then waits for IPC commands on **stdin**. You handle the work inline by sending JSON-per-line primitive ops on the runner's stdin (the FIFO you're already piping into for `{"op":"continue"}`); when the brief is satisfied, send a final `{"op":"continue"}` and the runner resumes the next block in the same browser context — no `--continue` flag, no `--from-block`, page state preserved.

**Agentic blocks are a LAST RESORT.** They should only exist when the block requires runtime decision-making (branching on unpredictable state, visual judgment, or dynamic query construction). Date pickers, edit dialogs, and Radix dropdowns are scriptable as components — challenge any agentic block before executing it.

The pause envelope shape:

```json
{
  "type": "agentic_pause",
  "test_case_id": "...",
  "execution_id": "...",
  "block_index": 3,
  "session_name": "runner_<execution_id>",
  "brief": "Verify today's daily order...",
  "expected_outcome": "Order exists with submitted status and 1+ line items",
  "page_url": "https://...",
  "profile": { "id": "...", "email": "...", "role": "Customer" }
}
```

`session_name` is informational telemetry only — it identifies this paused runner across logs. **It does NOT route `st4ck browse <op> --session <name>` calls** during a run-mode pause. Run-mode runners have their own internal Playwright instance and do not register a session.json in the `st4ck browse` CLI registry. The orchestrator drives the runner during the pause by writing primitive JSON ops to the runner's **stdin**, exactly the same shape you'd send to `st4ck browse` but written directly as JSON-per-line into the FIFO.

### How to drive the runner's browser during a pause

Every primitive op the `st4ck browse` CLI exposes is also accepted on the runner's stdin during agentic_pause. You write one JSON object per line into the same FIFO you opened to send `{"op":"continue"}`. The runner emits one response envelope on stdout per op, then waits for the next.

Frontend brief examples (write each JSON line to the runner's stdin FIFO):

```json
{"op":"snapshot"}
{"op":"click","locator":{"by":"role","value":"button","options":{"name":"Save"}}}
{"op":"fill","locator":{"by":"label","value":"Email"},"value":"alice@example.com"}
{"op":"wait_until","args":{"kind":"visible","locator":{"by":"role","value":"dialog"}}}
{"op":"evaluate","js":"document.querySelectorAll('[data-row-id]').length"}
```

Full op vocabulary (single source of truth = runner's `VALID_OPS` const): `evaluate`, `navigate`, `click`, `fill`, `press`, `select`, `check_box`, `hover`, `upload`, `click_by_text`, `hover_by_text`, `type_by_text`, `branch`, `wait_until`, `remember`, `recall`, `url`, `snapshot`, `screenshot`, `set_viewport_size`, `page_errors`, plus the control ops `continue` and `abort`. Argument shapes mirror the `st4ck browse <op>` flag set: see [/st4ck:browse](st4ck-browse.md) for the per-op argument tables — same payloads, just JSON-on-stdin instead of CLI flags.

Backend brief: call `mcp__st4ck-dev__bubble_list_records` / `mcp__st4ck-dev__supabase_query` to verify data via the project's DB (SELECT-only by default). The runner's stdin is for browser ops; backend verification stays in MCP land.

### Your job during the pause

1. Parse the pause envelope — `brief` is your primary instruction, `expected_outcome` is the verdict criterion. The `session_name` field is for telemetry only (see above).
2. Execute the brief by writing JSON-per-line ops to the runner's stdin FIFO (frontend) and/or calling `mcp__st4ck-dev__supabase_query` etc. (backend).
3. When the brief is satisfied, write `{"op":"continue"}` on the runner's stdin. The runner records the block as passed and resumes the next block in the same browser context.
4. If you cannot satisfy the brief, write `{"op":"abort","reason":"<short>"}` — the runner records the block as failed and exits.

## Rerun from failure

If a test failed at block N and the user wants to retry after a fix:

```bash
npx st4ck@latest run <test_case_id> <base_url> \
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
