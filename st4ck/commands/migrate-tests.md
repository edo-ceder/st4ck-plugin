---
description: Migrate legacy tests to v2 component format. Activates the qa-testing-migration skill, which classifies each test by shape (agentic / components_v1 / components_v2 / mixed) via classify_test_migration_shape and runs the appropriate internal branch (agentic re-author OR component-upgrade) inline. Per plan §13.2 (consolidated 2026-04-26 — was three skills before).
argument-hint: <suite_id | suite_name | --test <test_id> | --scope project>
---

# /st4ck:migrate-tests

This command is the explicit form of the **`qa-testing-migration`** skill — one consolidated skill with two internal branches:

- **Agentic re-author branch** (~10k tokens/test) — for `agentic` and `mixed` shapes. Runs the same orchestration as `/st4ck:regression-author`: dispatch one `qa-author` per legacy test, drive the journey, decompose into save_component(s) + create_test_case, atomic swap.
- **Component-upgrade branch** (~2k tokens/component) — for `components_v1` shape. Mostly mechanical: `eval_sequence` → `sequence` translation via `primitive_registry`, fresh snapshot, targeted citation gathering. Per-component escalation between branches handled inline.

Earlier drafts split this into three skills (router + Path A + Path B); collapsed 2026-04-26 because every dispatch boundary is a place agents lose context.

## Optional pre-seed

For projects with N>20 legacy tests where components clearly recur, the migration skill itself can dispatch a few `qa-author` teammates upfront with a "library-only" brief (drive candidate flows, save_component, no test composition). Authored components become available to both branches. Used to be a separate `/st4ck:bootstrap-components` skill; folded into the migration skill 2026-04-26 because "how to author a component" is one methodology section anyone can pull on demand.

## What to do

Activate the `qa-testing-migration` skill. The user's `$ARGUMENTS` is one of:

- A suite UUID
- A suite name (skill calls `get_test_suites` to resolve)
- `--test <test_id>` for a single-test scope
- `--scope project` for the whole project
- Empty (skill lists suites containing legacy tests and asks)

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`); sub-agents fetch on demand via `get_qa_methodology`.
