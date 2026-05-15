# st4ck

> **Role-separated implementation flow for st4ck projects — requirements through code, QA, and delivery.**

The full Claude Code plugin for st4ck. Where `st4ck-lite` covers recording + replay, this plugin adds the **agent-team orchestration** that structures the whole development lifecycle behind role separation and tool restriction.

```bash
# Inside Claude Code:
/st4ck:implement "Add a per-customer pallet allocation cap"   # full feature lifecycle
/st4ck:debug "Order edits aren't propagating to the shop"      # role-separated debug flow
/st4ck:po-research "Should orders be editable after submit?"   # PO discovery + options
/st4ck:impact                                                  # diff → which tests are affected
```

Every command dispatches purpose-built subagents with constrained tool surfaces — no one agent does everything, every step has a checkpoint, and quality is structurally enforced.

---

## What's bundled

### Lifecycle skills (the implementation flow)

| Skill | Purpose |
|---|---|
| `/st4ck:po-research` | Product-owner feature research — explores codebase, challenges requirements, surfaces logic gaps, presents solution options with effort/risk |
| `/st4ck:plan-author` | Comprehensive implementation plans — phased tasks, security analysis, test strategy, migration files |
| `/st4ck:implement` | Full feature lifecycle (requirements → plan → code → QA → deliver) with role-separated agents + human gates |
| `/st4ck:debug` | Role-separated debug flow — research, test gaps, fix, verify green. The session is the dev manager |
| `/st4ck:impact` | Agent-driven test impact analysis: reads local git diff, surfaces affected QA tests, queues `test_design_change` dev_tasks |
| `/st4ck:supervise` | Pause + regroup — reviews the session transcript, reminds you what you said, what's left |
| `/st4ck:regression-author` | Author regression test suites for shipped features |
| `/st4ck:regression-run` | Execute signed regression suites and report results with evidence (observe-only) |
| `/st4ck:version-author` | Author version tests for in-development features (green as implementation lands) |
| `/st4ck:qa-testing-migration` | Migrate legacy tests to the v2 component format |
| `/st4ck:qa-testing-debug` | Diagnose + fix a failed test or component |
| `/st4ck:st4ck-run` | Execute a deterministic test using the runner (with agentic-block IPC pause + rerun from failure) |
| `/st4ck:st4ck-browse` | Drive a real browser one IPC primitive at a time, optional `--record` saves as a deterministic md test |

### PRD authoring skills

Source-grounded Product Requirements Document authoring — useful when a platform has been live for a while and the test/spec layer needs an intent anchor.

| Skill | Purpose |
|---|---|
| `/st4ck:prd-from-source` | Author a PRD by reading source rather than asking the user. Four iron rules; Phase 0 preliminaries (checks `get_project_users`, asks user for role anchor + extra docs); two-pass mechanical-scaffold + curated-intent approach; cross-module reuse rule; audience triple-target (non-technical / QA / dev); confidence markers (CONFIRMED / INFERRED / GAP). |
| `/st4ck:prd-review` | Four-phase review pipeline — self-review → 3 parallel independent reviewers (PO / QA / Dev) → known-gaps-vs-code pass → bug-routing to dev tasks. Converges on diminishing returns. |

Three reviewer subagents — `prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev` — encode each review angle as a stable agent type for consistent, cached prompts across sessions.

### Code + QA agents (used internally by the lifecycle skills)

`code-agent`, `code-reviewer`, `codebase-explorer`, `qa-author`, `qa-reviewer`, `qa-runner`, `solution-analyst` — each with a constrained tool surface that enforces role separation.

---

## Three principles

**1. Role separation enforced by tools.** No agent does everything. The `qa-author` cannot modify code; the `code-agent` cannot author or sign tests; the `code-reviewer` is read-only. This isn't a convention — it's enforced by the tool allow-lists in each subagent definition.

**2. Server-enforced quality.** Test cases are signed by independent reviewers via the st4ck server. The signing record is part of the test's lineage; tests cannot land without it. Self-signing, blanket sign-offs, and dismissed findings are all impossible by construction.

**3. The intent layer is canonical.** PRDs, specs, and ADRs are the source of truth for behavior; code is the implementation that has to match them. When a test fails, the first question is "does the spec say this should pass?" — not "is the test wrong?". The PRD authoring skills bundled here exist because most platforms ship without this layer and only realize they need it after the first regression cycle.

---

## Free vs paid

This plugin is the open-source / self-host tier. The full `app.st4ck.io` platform adds:

- LLM self-heal on selector drift (Tier-2 healing).
- Cross-project knowledge base.
- TRIAD attestation + server-enforced review.
- Coverage reporting against intent sources.
- Security test generation pipeline.
- Multi-project + multi-environment orchestration.

→ Full platform: [st4ck.io](https://st4ck.io)

For the minimal recording + replay surface without lifecycle orchestration, use the [st4ck-lite plugin](https://github.com/st4ck/st4ck-lite) instead.

---

## What lives in this repo

- `.claude-plugin/plugin.json` — Claude Code marketplace metadata
- `st4ck/skills/` — the bundled skill set (lifecycle + PRD authoring)
- `st4ck/commands/` — slash command aliases
- `st4ck/agents/` — role-constrained subagents (code, QA, PRD reviewers)
- `docs/` — methodology + architecture documentation
- `poc/` — proof-of-concept work feeding back into the plugin

The runner itself is the `st4ck-runner` npm package.

---

## Install

In Claude Code:

```bash
/plugin marketplace add st4ck
/plugin install st4ck
```

Requires an `app.st4ck.io` workspace for the lifecycle skills' MCP server connections. Without one, you can still use the PRD authoring skills (file-only) and the recording subset.

---

## See also

- [agents.md](https://agents.md/) — the cross-agent project-steering convention
- [GitHub Spec Kit](https://github.com/github/spec-kit) — the spec-driven-development ecosystem the PRD skills slot into
