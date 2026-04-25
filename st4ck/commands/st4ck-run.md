---
description: Execute a deterministic test case using the st4ck runner. Handles agentic block handoff and rerun from failure. Supports both the legacy run-test.js (exit-42 protocol) and the new @st4ck/runner (IPC pause + storageState rehydrate).
argument-hint: <test_case_id> [--env <environment_name>] [--new-runner]
---

# /st4ck-run

You are an orchestrator for deterministic test execution. You select the appropriate runner, handle the pause protocol, and manage agentic block handoff.

## Runner selection

Two runners are wired in during the Phase 4–6 transition:

| Runner | Path | Pause protocol | When to use |
|---|---|---|---|
| **`@st4ck/runner`** (new) | `packages/st4ck-runner/dist/cli.js` (or `npx st4ck`) | IPC pause + `--browser-mode=rehydrate` | Tests where `test_cases.use_new_runner=true`; all newly authored tests; recordings produced by `npx st4ck author` |
| **`run-test.js`** (legacy) | `${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js` | exit-42 + `--continue --from-block <N>` | Tests where `use_new_runner=false`; the 340-test legacy regression suite during Phase 6 migration |

Plugin shim (plan §1.11) routes between them based on `use_new_runner`. If the user passes `--new-runner`, force the new runner regardless. Otherwise read the test row and dispatch.

## New-runner CLI shape (`@st4ck/runner`)

```bash
npx st4ck run <test_file_or_test_case_id> \
  --base-url <url> \
  --mode=execution        # default; set to "authoring" only for /st4ck-author flows
  --browser-mode=fresh    # default; "rehydrate" loads storageState from .st4ck/sessions/<id>.json
  --env <environment_name>
  --session "st4ck-$(date +%s)"
```

Pause protocol: when the runner needs the agent to handle an agentic block, it writes a JSON pause envelope to a named pipe (IPC) and **stays alive**. The agent reads the envelope, performs the work, writes the result back to the same pipe, and the runner resumes in the same browser context. No process death, no `--continue`, no storageState reload — the page state is preserved.

Recordings (from `npx st4ck author`) live as markdown files at `.st4ck/recordings/<slug>.md`. Pass the path directly to `npx st4ck run` to replay them — no DB roundtrip required.

## Resolution

From `$ARGUMENTS`:

| Input | Behavior |
|-------|----------|
| UUID | Test case ID — run it directly |
| Test name | Search via `get_test_cases`, find matching test, use its ID |
| Nothing | Ask user which test to run |

## Pre-Flight

1. Call `get_test_details(test_case_id)` to load the test
2. Verify the test has `scenario_blocks` (not empty)
3. Check review signatures:
   - Component-format tests: need `journey_signature` + all referenced components must have `review_signature`
   - Legacy-format tests: need `review_signature`
4. Resolve the environment:
   - If `--env` provided, look up `test_environments` by name
   - Otherwise use the first active environment for the project

## Execution — legacy runner (`run-test.js`)

**Note**: The script handles profile acquisition/release internally — do NOT acquire profiles yourself.

Run the deterministic runner:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> --session "st4ck-$(date +%s)"
```

### Handle Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| **0** | All blocks passed | Report success |
| **1** | Failure | Read the log, report failure with evidence |
| **42** | Agentic pause | Read stdout JSON, handle the agentic block (see below), then continue |

**Note**: Profile acquisition and release is handled internally by the script. Do NOT manage profiles yourself.

## Execution — new runner (`@st4ck/runner`)

Run the test through the new runner. The runner stays alive across pauses (IPC), so there are no exit codes for pauses — only a final 0 (pass) or 1 (fail).

```bash
npx st4ck run <test_case_id_or_recording_path> \
  --base-url <url> --env <env_name> --session "st4ck-$(date +%s)"
```

For agentic blocks, the runner emits a pause envelope on the IPC channel and waits for your reply. There is no `--from-block N` because the same browser context is held; you reply to the pause with the block result and the runner resumes in place.

If the test was recorded under `npx st4ck author` and lives in `.st4ck/recordings/<slug>.md`, pass the file path instead of a UUID — no `get_test_details` call needed.

### Agentic Block Handoff (exit 42)

**Agentic blocks are a LAST RESORT.** They should only exist when the block requires runtime decision-making (branching on unpredictable state, visual judgment, or dynamic query construction). If a test has agentic blocks for "complex UI" like date pickers, edit dialogs, or Radix dropdowns — those should be scripted as components instead. Challenge any agentic block before executing it.

When the script exits with code 42, stdout contains a comprehensive JSON pause envelope with everything you need:
```json
{
  "status": "agentic_pause",
  "block": 3, "action": 0,
  "execution_id": "...", "test_case_id": "...",
  "block_mode": "agentic",
  "agentic_brief": "Verify today's daily order...",
  "block_info": {
    "block_type": "backend", "role": "Customer",
    "properties": { "cross_company": true },
    "entry_url": null, "expected_outcome": "..."
  },
  "captures": { "daily_order_id": "..." },
  "next_step": "Execute the brief..., then resume with: node ... --continue ... --from-block 4"
}
```

1. Parse the pause envelope — `agentic_brief` is your primary instruction, `captures` has values from earlier scripted blocks
2. Handle the agentic block yourself:
   - **Backend blocks**: Use `bubble_list_records` / `supabase_query` MCP tools to verify data
   - **Frontend blocks**: Use `agent-browser` CLI via Bash (same session the runner was using)
   - If `block_info.role` is set and you need credentials, call `acquire_profile(role, properties, environment_id)`
3. Save your block result via `save_execution_log(execution_id, structured_log_update)`
4. Restart the runner to continue:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> \
  --continue <execution_id> --from-block <next_block>
```

5. Repeat until exit 0 or exit 1

### Rerun from Failure

If a test failed at block N and the user wants to retry after a fix:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> \
  --continue <execution_id> --from-block <N>
```

## Report

```
## Test Run: [test_name]

**Status**: PASSED / FAILED / ERROR
**Runner**: deterministic (zero LLM cost)
**Duration**: [X]s
**Blocks**: [passed]/[total]

### Block Results
| # | Type | Description | Status | Duration |
|---|------|-------------|--------|----------|
| 0 | frontend | Login | passed | 2.1s |
| 1 | frontend | Navigate | passed | 0.8s |
| 2 | backend | Seed data | agentic (handled) | 1.2s |
| 3 | frontend | Verify | FAILED | 3.5s |

### Failure Details (if any)
- **Block 3, Action 1**: Verify condition timed out after 20s
- **DOM Snapshot**: [truncated snapshot]
- **Console Errors**: [any JS errors]

### Execution ID: [uuid]
Use `--continue <id> --from-block 3` to retry from the failed block.
```
