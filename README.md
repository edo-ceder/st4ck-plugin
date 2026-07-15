# st4ck

> **The agent-and-human lifecycle surface for full st4ck — requirements through code, QA, and delivery.**

st4ck has two product surfaces: `st4ck-lite`, the local OSS surface, and full st4ck, which pairs this plugin with an `app.st4ck.io` workspace. Full st4ck builds on Lite's PRD authoring, agent-driven recording, and deterministic replay and adds **agent-team lifecycle orchestration**, persistent intent, test/component lineage, attestation, impact analysis, and shared reuse. The MCP-backed lifecycle features require a workspace; the plugin is their agent-and-human client, not a standalone middle tier.

```bash
# Inside Claude Code:
/st4ck:implement "Add a per-team usage cap to the billing portal"   # full feature lifecycle
/st4ck:debug "Profile edits aren't appearing in the activity feed"  # role-separated debug flow
/st4ck:po-research "Should refunds be reversible after settlement?" # PO discovery + options
/st4ck:impact                                                       # diff → which tests are affected
```

Lifecycle commands coordinate purpose-built subagents, explicit human checkpoints, and role-specific write restrictions where configured. Those controls reduce accidental role overlap; the authoritative lineage, attestation, execution, and required-review gates are enforced by the st4ck service.

---

## What's bundled

### Managed Slack package

The marketplace also includes `st4ck-managed-slack`, a deliberately small package for a managed Claude Tag in one shared Slack project channel. It contributes one project-bound remote MCP connector and a concise shared-channel operating skill. The package contains no credential; its Claude Tag Access bundle supplies the project-bound authorization at runtime.

Install this package only in the managed Access bundle for the intended Slack channel. Reuse the package, but use a separate project-bound credential and Access bundle for every project channel; never reuse one client's bundle in another channel. It is separate from the full Claude Code lifecycle plugin documented below.

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

`code-agent`, `code-reviewer`, `codebase-explorer`, `qa-author`, `qa-reviewer`, `qa-runner`, `solution-analyst` — each with a defined workflow role and role-specific tool/write settings. These client-side settings are workflow guardrails, not a security boundary.

---

## Three principles

**1. Role separation by workflow and configured write scopes.** No agent is asked to do everything. The `qa-author` is configured without direct file-edit tools, the `code-agent` is not given st4ck QA tools, and the `code-reviewer` is configured without Edit/Write. Prompts and client tool settings reduce accidental overlap, but they are not a sandbox or security boundary.

**2. Server-enforced lineage and attestation.** The st4ck service persists test/component lineage, required intent and coverage attestations, execution evidence, and signatures. Eligible standard suites may self-sign only after a passing execution and non-empty end-to-end coverage attestation. High-risk or explicitly flagged suites — including security, version-gate, and high-blast-radius suites — reject self-signing and require an independent reviewer.

**3. The intent layer is canonical.** PRDs, specs, and ADRs are the source of truth for behavior; code is the implementation that has to match them. When a test fails, the first question is "does the spec say this should pass?" — not "is the test wrong?". The PRD authoring skills bundled here exist because most platforms ship without this layer and only realize they need it after the first regression cycle.

**The result:** authoring cost trends *down* as the suite grows — every new test reuses signed components, every component reuses signed intent. Compare Gherkin/Cucumber, where each new scenario rebuilds glue code from scratch and step-definition maintenance scales linearly with the suite.

---

## Product surfaces

st4ck has two product surfaces. The plugin in this repository is the client half of full st4ck and is paired with the workspace; it is not a separate tier between Lite and the platform.

| Capability | `st4ck-lite` / local OSS | Full st4ck: this plugin + `app.st4ck.io` workspace |
|---|:---:|:---:|
| Agent-driven record + deterministic md replay (zero LLM at replay) | ✓ | ✓ |
| Locator-priority ladder (Tier-1 self-heal) | ✓ | ✓ |
| PRD authoring + 3-angle review pipeline | ✓ | ✓ |
| Basic local component authoring + reuse | Intended OSS capability; local registry not yet shipped in the current Lite alpha | ✓, backed by the workspace registry |
| Lifecycle orchestration (`po-research` → `plan` → `implement` → `debug` → `impact`) | — | ✓ |
| Role-specific code + QA agent workflows | — | ✓ |
| Server-enforced test/component lineage + attestation | — | ✓ |
| Independent review for high-risk or flagged suites | — | ✓ |
| LLM self-heal on selector drift (Tier-2) | — | ✓ |
| Cross-project knowledge base + coverage reporting | — | ✓ |
| Security test generation + multi-project/environment orchestration | — | ✓ |

- **`st4ck-lite` / local OSS** — no account, service, or MCP required. The current alpha ships local PRD skills plus agent-driven recording and deterministic md replay. Basic local component authoring and reuse belongs on this OSS surface too; its local registry has not shipped yet. → [github.com/edo-ceder/st4ck-lite](https://github.com/edo-ceder/st4ck-lite)
- **Full st4ck** — this open-source plugin paired with an `app.st4ck.io` workspace. The plugin supplies the agent-and-human lifecycle surface; the workspace supplies MCP services for persistent lineage, attestation, a signed shared component registry, intent binding, impact/coverage, healing, and collaboration. → [st4ck.io](https://st4ck.io)

Basic local component authoring is not intended to be a paywall. Full st4ck's differentiation is the compounding, server-backed test system: reusable components tied to signed lineage and intent, required attestations and review gates, team knowledge, analytics, healing, and agentic orchestration.

---

## What lives in this repo

- `.claude-plugin/marketplace.json` — Claude Code marketplace metadata
- `st4ck/skills/` — the bundled skill set (lifecycle + PRD authoring)
- `st4ck/commands/` — slash command aliases
- `st4ck/agents/` — role-specific subagents (code, QA, PRD reviewers)
- `st4ck-managed-slack/` — dedicated managed Claude Tag package (one project-bound MCP endpoint + shared-channel skill)
- `docs/` — methodology + architecture documentation
- `poc/` — proof-of-concept work feeding back into the plugin

Two npm packages underneath — the `st4ck` brand binary (CLI wrapper) plus the `st4ck-runner` it wraps. The lite plugin uses the same pair.

---

## Install

In Claude Code:

```bash
/plugin marketplace add edo-ceder/st4ck-plugin
/plugin install st4ck@st4ck-marketplace
```

Before releasing a plugin update, validate both Claude manifests/frontmatter and the local Browse/version contract:

```bash
claude plugin validate .
claude plugin validate ./st4ck
node scripts/validate-plugin.mjs
```

The plugin version lives only in `st4ck/.claude-plugin/plugin.json`. Anthropic recommends avoiding a duplicate marketplace-entry version; one declaration makes release and cache behavior unambiguous. The contract check compares against `origin/main` by default. Fetch that ref first, or set `ST4CK_PLUGIN_BASE_REF=<existing-ref>` when validating a fork, shallow checkout, or another release base; a missing ref fails with an actionable error instead of an opaque Git failure.

The MCP-backed lifecycle skills require an `app.st4ck.io` workspace. Without one, the shared local surface remains usable: file-only PRD authoring, agent-driven recording, and deterministic replay. Basic local component authoring also belongs on the local OSS surface, although the current Lite alpha has not yet shipped its local registry.

---

## See also

- [agents.md](https://agents.md/) — the cross-agent project-steering convention
- [GitHub Spec Kit](https://github.com/github/spec-kit) — the spec-driven-development ecosystem the PRD skills slot into
