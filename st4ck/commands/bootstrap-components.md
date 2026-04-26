---
description: Phase 6 §6.2 — seed the project's test_components library before per-test migration. Calls get_component_discovery, then the current session agent (acting as the authoring lead) dispatches component-author teammates per candidate. Returns a populated component pool. Run before `/st4ck:migrate-tests` against a fresh project.
argument-hint: <module-name | --intent-source <type:id>>
---

# /st4ck:bootstrap-components

Activates the `qa-testing-bootstrap-components` skill. Run this BEFORE running `/st4ck:migrate-tests` against a project for the first time — Path A migrations benefit from a pre-seeded library, and Path B's citation-gathering benefits from already-grepped sources.

Also useful when:
- Coverage gaps surface uncovered intent_sources and you want to author the components needed before authoring tests against them
- A new module is added to the project and you want components seeded before tests are written

## What to do

Activate the `qa-testing-bootstrap-components` skill. The user's `$ARGUMENTS` is one of:
- A module name (limits discovery to that module)
- `--intent-source <type:id>` to scope discovery to a specific PRD node / spec section / dev_task
- Empty (whole-project bootstrap)

Do NOT duplicate the skill's procedure here. The skill is the canonical source of truth.

All methodology rules live on the server (`backend/src/mcp/v3/methodology.ts`); sub-agents fetch on demand via `get_qa_methodology`.
