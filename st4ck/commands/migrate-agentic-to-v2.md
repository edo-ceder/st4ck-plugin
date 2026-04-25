---
description: Path A migration — full Agent Teams re-author cycle for legacy agentic + mixed-shape tests. Heavy budget (~10k tokens/test). Skips classifier; assumes you already know the test is Shape A or C.
argument-hint: <test_id | suite_id>
---

# /st4ck:migrate-agentic-to-v2

Activates the `qa-testing-migrate-agentic-to-v2` skill (Path A). Use when:
- The router (`/st4ck:migrate-tests`) already classified the scope as agentic / mixed
- You're explicitly migrating one test you know is Shape A
- The router demoted a Path B candidate

For mixed shape suites, prefer `/st4ck:migrate-tests` — the router avoids wasted Path A work on Shape-B tests.

## What to do

Activate the `qa-testing-migrate-agentic-to-v2` skill. The user's `$ARGUMENTS` is the target test_id (UUID) or suite_id (UUID); empty defers to skill's prompting.

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`); sub-agents fetch on demand via `get_qa_methodology`. Nothing duplicated here.
