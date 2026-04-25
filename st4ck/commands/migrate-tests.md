---
description: Migrate legacy tests to v2 component format. Acts as the ROUTER — classifies each test by shape (agentic / components_v1 / components_v2 / mixed) via classify_test_migration_shape, then dispatches Path A (heavy, ~10k tokens/test) or Path B (light, ~2k tokens/component). Per plan §13.2.
argument-hint: <suite_id | suite_name | --test <test_id> | --scope project>
---

# /st4ck:migrate-tests

This command is the explicit form of the **`qa-testing-migration`** skill — which is now the ROUTER, not a single migration journey. Per plan §13.2 it classifies each test and dispatches one of:

- **`/st4ck:migrate-agentic-to-v2`** (Path A — heavy, full Agent Teams cycle) for `agentic` and `mixed` shapes
- **`/st4ck:upgrade-components-v1-to-v2`** (Path B — light, mechanical) for `components_v1` shape

The router's whole purpose is to avoid wasting Path A's ~10k tokens on a Shape-B test that Path B handles in ~2k.

## Before you migrate

If this is the first migration run against this project, **first run `/st4ck:bootstrap-components`** to seed the test_components library. Path A re-authors benefit from a pre-seeded library; Path B's citation-gathering benefits from already-grepped sources.

## What to do

Activate the `qa-testing-migration` skill (the router). The user's `$ARGUMENTS` is one of:
- A suite UUID
- A suite name (router calls `get_test_suites` to resolve)
- `--test <test_id>` for a single-test scope
- `--scope project` for the whole project
- Empty (router lists suites containing legacy tests and asks)

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`); sub-agents fetch on demand via `get_qa_methodology`. Nothing duplicated here.
