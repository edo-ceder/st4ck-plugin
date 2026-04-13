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
