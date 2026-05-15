---
description: Diagnose and fix a failed test or component. Reads the execution log, classifies the failure, proposes a scoped fix, and drives the fix to green without scope creep.
argument-hint: <execution_id | test_case_id | "free-text symptom">
---

# /st4ck:qa-testing-debug

This command is the explicit form of the **`qa-testing-debug`** skill. The skill auto-activates on free-text intent ("this test is failing", "debug this run", "selector is wrong", "block N failed", "test X broke") — this slash command is the muscle-memory alternative.

## What to do

Activate the `qa-testing-debug` skill. The user's `$ARGUMENTS` is one of:

- An `execution_id` to fetch the log for
- A `test_case_id` whose most-recent failure should be diagnosed
- A free-text symptom ("the login test is failing on block 3", "selector for the close button broke")
- Empty (skill asks which failure to debug)

Do NOT duplicate the skill's diagnosis loop here. The skill orchestrates: read execution log → classify failure → propose scoped fix → drive to green. All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`) and are fetched on demand by sub-agents via `get_qa_methodology`.
