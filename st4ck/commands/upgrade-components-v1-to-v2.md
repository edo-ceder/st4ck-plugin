---
description: Path B migration — light, mostly-mechanical upgrade of v1 components to v2 (sequence + TRIAD + git-cited citations). Budget ~2k tokens/component. Demotes individual components to Path A on exotic eval / persisted ref / unreachable component / TRIAD-rejection.
argument-hint: <test_id | suite_id>
---

# /st4ck:upgrade-components-v1-to-v2

Activates the `qa-testing-upgrade-components-v1-to-v2` skill (Path B). Use when:
- The router (`/st4ck:migrate-tests`) already classified the scope as `components_v1`
- You're explicitly upgrading one Shape-B test you know about
- You want to upgrade a component-set without touching tests (the test record stays unchanged; only its components get re-saved)

For agentic / mixed shapes, prefer `/st4ck:migrate-agentic-to-v2` (Path A) — Path B will return `wrong_path` on those.

## What to do

Activate the `qa-testing-upgrade-components-v1-to-v2` skill. The user's `$ARGUMENTS` is the target test_id (UUID) or suite_id (UUID); empty defers to skill's prompting.

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`); sub-agents fetch on demand via `get_qa_methodology`.
