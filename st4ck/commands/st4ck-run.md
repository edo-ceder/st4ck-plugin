---
description: Execute a deterministic test case using the st4ck runner. Handles agentic block handoff and rerun from failure.
argument-hint: <test_case_id> [--env <environment_name>]
---

# /st4ck-run

You are an orchestrator for deterministic test execution. You call `run-test.js`, handle exit codes, and manage agentic block handoff.

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

## Execution

**Note**: The script handles profile acquisition/release internally — do NOT acquire profiles yourself.

Run the deterministic runner:

```bash
ST4CK_TOKEN="$TOKEN" node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> --session "st4ck-$(date +%s)"
```

### Handle Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| **0** | All blocks passed | Report success |
| **1** | Failure | Read the log, report failure with evidence |
| **42** | Agentic pause | Read stdout JSON, handle the agentic block (see below), then continue |

**Note**: Profile acquisition and release is handled internally by the script. Do NOT manage profiles yourself.

### Agentic Block Handoff (exit 42)

When the script exits with code 42, stdout contains:
```json
{"status":"agentic_pause","block":3,"action":2,"execution_id":"...","test_case_id":"..."}
```

1. Read the block definition from the test case's `scenario_blocks[block]`
2. Handle the agentic action yourself:
   - **SQL actions**: Execute via MCP `supabase_query` tool
   - **API actions**: Use `fetch` or appropriate MCP tool
   - **Complex actions**: Use your judgment (you're Sonnet, you can reason)
3. Save your block result via `save_execution_log(execution_id, structured_log_update)`
4. Restart the runner to continue:

```bash
ST4CK_TOKEN="$TOKEN" node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
  <test_case_id> <base_url> \
  --continue <execution_id> --from-block <next_block>
```

5. Repeat until exit 0 or exit 1

### Rerun from Failure

If a test failed at block N and the user wants to retry after a fix:

```bash
ST4CK_TOKEN="$TOKEN" node ${CLAUDE_PLUGIN_ROOT}/scripts/run-test.js \
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
