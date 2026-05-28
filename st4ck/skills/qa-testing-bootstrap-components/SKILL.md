---
name: qa-testing-bootstrap-components
description: Forwarding stub. This skill was consolidated into qa-testing-migration on 2026-04-26 (plan §13.2, mid-12). Activate qa-testing-migration instead — it covers Path A (heavy re-author) AND Path B (light component-upgrade) inline, with classify_test_migration_shape selecting the branch per test.
---

# qa-testing-bootstrap-components — consolidated

This skill name was retired on **2026-04-26** when the migration paths were consolidated into a single skill (plan §13.2, mid-12 changelog).

## What to do

Activate the **`qa-testing-migration`** skill. It runs `classify_test_migration_shape` per test and dispatches the appropriate internal branch:

- **Path A (heavy re-author)** — for `agentic` and `mixed` shapes. ~10k tokens/test.
- **Path B (light component-upgrade)** — for `components_v1` shape. ~2k tokens/component. Per plan §6.0 (no-code platform support, 2026-04-26), the classifier now also emits `path_b_blockers` so `components_v1` tests with platform-specific eval workarounds (Bubble MouseEvent chains, branch pseudo-steps, race/iteration history) auto-route to Path A — saving the budget burn the original Path B sweep would otherwise hit.

Forward your `$ARGUMENTS` to `qa-testing-migration` unchanged.

## Why this exists

Long-lived agent sessions cached the pre-consolidation skill catalog and continued to invoke this name. Rather than fail with `Unknown skill`, this stub redirects the work in one turn so the catalog drift recovers itself.

<!-- sunset_after: 2026-10-26 — delete on next audit if no agent session older than 6 months has invoked this name. -->
