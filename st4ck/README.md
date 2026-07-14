# st4ck Plugin for Claude Code

The agent-and-human lifecycle surface for full [st4ck](https://st4ck.io) — from requirements through code, QA, and delivery. Full st4ck pairs this plugin with an `app.st4ck.io` workspace; MCP-backed lifecycle features require that workspace.

## What This Plugin Does

A single agent that writes code, creates tests, runs tests, and reviews results can miss important checks. This plugin coordinates distinct workflow roles:

- **Code Agent** implements code without st4ck QA tools in its configured allowlist
- **QA Author** writes tests from intent, source, and live behavior; direct file Edit/Write tools are disabled, while source Read and `st4ck browse` access remain available
- **QA Reviewer** independently reviews high-risk or explicitly flagged suites; eligible standard suites may self-sign after the server's execution and attestation gates pass
- **QA Runner** executes signed tests and reports evidence; its prompt is execution-only, while signature and test-shape validation are enforced by the service and runner
- **Code Reviewer** reviews code with confidence scoring and is configured without Edit/Write tools

Claude Code `tools` / `disallowedTools` frontmatter and role prompts provide useful write-scope guardrails, but they are not a security boundary. Durable guarantees come from server-enforced lineage, required attestations, passing-execution checks, and independent-review requirements for flagged suites.

## Prerequisites

### Required
- **An `app.st4ck.io` workspace and its st4ck MCP servers** must be configured in your project `.mcp.json` or `~/.claude.json` for the MCP-backed lifecycle. This plugin cannot configure MCP servers (security restriction for plugins).

  Add to your project's `.mcp.json`:
  ```json
  {
    "mcpServers": {
      "st4ck-qa": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/v3/?apiKey=YOUR_API_KEY"
      },
      "st4ck-pm": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/pm/?apiKey=YOUR_API_KEY"
      },
      "st4ck-dev": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/dev/?apiKey=YOUR_API_KEY"
      },
      "st4ck-ops": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/ops/?apiKey=YOUR_API_KEY"
      }
    }
  }
  ```

  Four role-scoped servers: `st4ck-qa` (test authoring + execution), `st4ck-pm` (PRDs, specs, decisions, todos), `st4ck-dev` (dev tasks, code/data introspection, issues), `st4ck-ops` (usage, quotas, admin). The retired single-server `/mcp/` and `/mcp/v2/` paths return 410 Gone.

### Recommended
- **`st4ck` CLI** (`npx st4ck@latest`) — brand binary that wraps the deterministic Playwright runner behind three verbs: `st4ck author` (bootstrap), `st4ck browse [--record]` (drive a session, one Bash call per primitive), `st4ck run` (replay a signed test or md trace). Without it, tests are authored but not executed. `@latest` always resolves to the current release; pin to an explicit version (e.g. `@0.2.0-alpha.1`) only when CI reproducibility matters.

### Optional
- **context7** — for technology validation during plan authoring
- **Supabase MCP** — for database schema queries during exploration

## Installation

In Claude Code:

```bash
/plugin marketplace add edo-ceder/st4ck-plugin
/plugin install st4ck@st4ck-marketplace
```

Then `/reload-plugins` to activate. From a local checkout:

```bash
/plugin marketplace add /path/to/st4ck-plugin
/plugin install st4ck@st4ck-marketplace
```

## Commands

### `/implement` — Full Feature Lifecycle

```
/implement <st4ck spec ID | plan file path | gh:org/repo#123 | description>
```

Four phases with human gates:
1. **Acquire requirements** — detect source, explore codebase, present understanding → human confirms
2. **Author plan** — phased tasks, security analysis, test strategy → human approves
3. **Autonomous loop** — code + QA in parallel tracks, fix loop with circuit breakers
4. **Results** — completion report with evidence → human reviews

### `/po-research` — PO Feature Research

```
/po-research <feature description | st4ck spec ID>
```

Help Product Owners think through features before writing requirements:
1. Discover what the PO wants
2. Explore the codebase for relevant patterns
3. Challenge incomplete thinking, surface logic gaps
4. Present solution options with effort/risk/trade-offs
5. Optionally save requirements to st4ck

### `/regression-author` — Regression Test Authoring

```
/regression-author <module name | "full-app" | PRD node ID>
```

Create regression test suites for shipped features:
- 5-pass approach per module (survey → deep read → per-role → cross-role → audit)
- Server-gated signing: eligible suites may self-sign after passing execution plus a non-empty end-to-end coverage attestation; high-risk or explicitly flagged suites require independent QA review
- Coverage report against PRD

### `/regression-run` — Regression Test Execution

```
/regression-run <suite name | suite ID | "all" | "module:ModuleName">
```

Execute signed regression suites and report results:
- Pre-flight health check
- Evidence-based reporting (screenshots, console errors)
- Observe-only — does not attempt fixes
- Schedulable for nightly runs

### `/version-author` — Version Test Authoring

```
/version-author <plan path | plan_phase ID | dev_task ID | feature name>
```

Author version tests for in-development features — tests that go GREEN as implementation lands phase-by-phase:
- Reads the plan-phase Journey table verbatim as the test contract
- Dispatches one `qa-author` per journey; an independent `qa-reviewer` signs suites flagged for independent review, while eligible suites follow the server-gated self-sign path
- Each test carries `gates_on_plan_phase` so it stays red until the phase ships
- `intent_sources` populated from the plan's user-journey row + dev_task
- Pairs with `/implement` Track B for TDD-style development

### `/st4ck:migrate-tests` — Legacy → v2 Component Format

```
/st4ck:migrate-tests <suite_id | suite_name | --test <id> | --scope project>
```

Migrate legacy tests to the v2 component format. The skill classifies each test by shape via `classify_test_migration_shape` and runs the appropriate branch inline:
- **Agentic re-author** (~10k tokens/test) for `agentic` and `mixed` shapes — same orchestration as `/regression-author`
- **Component-upgrade** (~2k tokens/component) for `components_v1` shape — mostly mechanical translation via `primitive_registry` + fresh snapshot
- Per-component escalation between branches handled inline
- Optional pre-seed for projects with N>20 legacy tests where components recur

### `/st4ck:impact` — Test Impact Analysis

```
/st4ck:impact [--base <branch>] [--staged] [--propose] [--limit <N>]
```

Agent-driven test impact analysis (Phase 5 §5.2). Reads the local git diff and surfaces every QA test whose components cite the changed lines:
- Queues `test_design_change` dev_tasks for QA
- `--base <branch>` diff against a base (default `HEAD^`); `--staged` for staged-only
- `--propose` invokes the LLM-driven propose subworkflow per affected component (expensive; cap with `--limit`)
- Read-mostly: writes via `create_dev_task` only

### `/st4ck:browse` — Drive a Real Browser One Primitive at a Time

```
/st4ck:browse <url> [--session <name>] [--record [--out <path>]] [--instruction "<text>"]
              [--device "<name>"] [--viewport <WxH>] [--locale <bcp47>]
              [--timezone-id <iana>] [--headless] [...]
```

Each subcommand is one Bash invocation; the wrapper hides the runner + FIFO behind the scenes:
- Multi-session out of the box (`-s alice` / `-s bob` route to independent runners)
- 14-flag emulation surface aligned to Playwright field names (device, viewport, locale, timezone, color-scheme, reduced-motion, geolocation, permissions, etc.)
- Optional `--record` saves the trace as a deterministic md test you can replay with `st4ck run`
- Returns the `runner_ready` envelope including `requested_url`, `redirected`, `page_errors`, `blank_page_detected` so you catch silent auth-bounces and broken bundles on first paint

### `/st4ck-run` — Deterministic Test Execution

```
/st4ck-run <test_case_id | test name | recording.md path> [--environment <env>]
```

Execute a signed test case via the runner with full agentic-block IPC handling:
- Wraps `npx st4ck@latest run` with auth (`ST4CK_TOKEN` from MCP), pre-flight, and result reporting
- Handles agentic block handoff via IPC pause (parent agent drives the brief inline against the same `session_name`)
- `--continue <execution_id> --from-block <N>` resumes a prior run after the agentic block
- Same browser-context emulation surface as `/st4ck:browse` on replay
- Recordings from `/st4ck:browse --record` at `.st4ck/recordings/<slug>.md` replayable directly (no DB roundtrip)

### `/debug` — Bug Investigation & Fix

```
/debug <bug description | dev task IDs | "console errors" | st4ck spec ID>
```

Dev-manager-led debug operation with role separation:
1. **Intake** — consolidate bugs by code area
2. **Research** — parallel codebase-explorer agents per area
3. **Test gap analysis** — find missing tests that should have caught this
4. **Fix** — code-agent fixes root causes (rejects workarounds)
5. **Write missing tests** — qa-author closes test gaps
6. **Verify** — smoke gate + full test run with mandatory console/network checks
7. **Regression assessment** — recommend tests for permanent regression suite

### `/supervise` — Session Supervisor

```
/supervise
```

Checks if the agent is on track, drifting, or trying to stop prematurely:
- Reads the session transcript and reconstructs evolving user intent
- Compares intent against what the agent actually did
- Catches: incomplete work, skipped blocks, fabricated limitations, data contamination
- Injects a nudge that the agent must follow, or STOPs for human input
- Run it whenever you suspect the agent drifted or declared "done" too early

Phase 2 (coming): automated Stop hook that runs this check every time the agent tries to stop.

### `sub-agent-verify-reminder` hook (opt-in)

Fires after every `Agent` / `Task` (sub-agent dispatch) tool call and injects a short reminder into the orchestrator's next-turn context:

> ⚠ **verify-before-act reminder** — Before filing a dev_task, st4ck issue, or accepting this sub-agent's "can't" / "doesn't exist" / "blocked" / "no \<X\> exists" claim: verify the load-bearing claim yourself with a direct tool call. Sub-agents systematically optimize for completing the literal brief over the user's actual outcome — they will report "can't" when the real answer is "didn't try hard enough" or "wrong premise".

The hook is **gated OFF by default** (the script self-checks an env var and silently no-ops when not set, so installing the plugin doesn't change behavior for users who don't want this). Opt in by exporting the flag in your shell profile (`~/.zshrc` / `~/.bashrc`):

```bash
export ST4CK_HOOKS_SUB_AGENT_VERIFY_REMINDER=true
```

Restart your Claude Code session and the reminder will appear after every sub-agent dispatch. To disable, unset the env var or set it to anything other than `true|TRUE|1|yes|YES`.

Why: orchestrators systematically accept sub-agent verdicts ("can't find X", "X is broken", "X doesn't exist") and act on them — filing tickets, retiring tests, abandoning features — without verifying the load-bearing claim. Memory rules don't get re-read at the decision point. A hook makes the rule physically visible at the moment it matters. Pattern documented across st4ck issues `a617eca9`, `5ad916d2`, `4797f9d7`, `ef715e2a`, `7a03ce10`.

## Agent Architecture

| Agent | Role | Configured client guardrails |
|-------|------|------------------------------|
| Code Agent | Implement features | Explicit allowlist includes Edit/Write/Bash but no st4ck QA tools |
| Code Reviewer | Independent code review | Explicit allowlist omits Edit/Write |
| Codebase Explorer | Explore and understand code | Explicit read-oriented allowlist; Bash remains available |
| Solution Analyst | PO-friendly solution analysis | Explicit read-oriented allowlist; Bash remains available |
| QA Author | Author tests from intent, source, and the running app | Edit/Write/NotebookEdit and Playwright MCP are disallowed; Bash remains available for `st4ck browse` |
| QA Reviewer | Review and sign tests when independent review is required | Edit/Write/Bash/NotebookEdit and Playwright MCP are disallowed |
| QA Runner | Execute signed tests and report evidence | Playwright MCP is disallowed; runner/service preflight validates signatures and forbidden test actions |

These settings reduce accidental role overlap. They do not make the agent process a sandbox; deployments that need a hard security boundary must enforce it outside the client prompt/tool configuration.

## When to Use / When NOT to Use

**Use `/implement` for:**
- New features with clear requirements
- Features that benefit from automated QA
- Work where quality enforcement matters

**Use `/debug` for:**
- Multiple related bugs to investigate and fix
- Bugs that need test gap analysis
- Post-deployment issues where you want regression protection
- When you want to push through a fix with full verification

**Don't use for:**
- Single trivial bug (just fix it)
- Config changes or small refactors
- Exploratory prototyping

**Use `/po-research` for:**
- Features in the ideation stage
- When the PO isn't sure about scope or approach
- Before writing detailed specs

**Use `/regression-author` + `/regression-run` for:**
- Building safety nets for shipped features
- After major releases to lock down behavior
- Nightly confidence checks

**Use `/version-author` for:**
- TDD-style development against a plan with phased journeys
- Tests that should stay red until a `dev_task` ships (per `gates_on_plan_phase`)
- Pairing with `/implement` Track B

**Use `/st4ck:migrate-tests` for:**
- Bringing legacy tests into the v2 component format
- Bulk modernization of an existing regression suite

**Use `/st4ck:impact` for:**
- Pre-merge "what tests does my diff break?" analysis
- Triaging a refactor's QA blast radius
- Optionally generating proposed component updates with `--propose`

**Use `/st4ck:browse` for:**
- Driving a real browser one primitive at a time during authoring
- Recording deterministic md traces for replay (`--record`)
- Multi-session exploration (different roles, parallel flows)

**Use `/st4ck-run` for:**
- Executing a signed test case manually
- Resuming a run after an agentic-block IPC pause
- Replaying a `.st4ck/recordings/<slug>.md` file produced by `/st4ck:browse --record`

### QA skills auto-activate on free-text intent

The QA authoring commands have matching **intent skills** that auto-activate when you speak naturally. Saying "create regression tests for Expenses" triggers the `qa-testing-regression` skill (equivalent to `/regression-author Expenses`). The slash commands remain as the explicit muscle-memory form.

| Intent phrase | Skill | Equivalent command |
|---|---|---|
| "create regression tests for X" / "protect module Y" | `qa-testing-regression` | `/regression-author X` |
| "write tests for this feature/plan" / "version tests for" | `qa-testing-version` | `/version-author <plan>` (also used by `/implement` Track B) |
| "this test is failing" / "debug this run" / "selector is wrong" | `qa-testing-debug` | (no slash command) |
| "migrate these tests" / "convert to component format" | `qa-testing-migration` | `/st4ck:migrate-tests <suite>` |

All four skills load the QA methodology on demand from the server (`backend/src/mcp/v3/methodology.ts`) via `get_qa_methodology` — no methodology prose is duplicated client-side.

## Known Limitations (v1)

- **Single-project only** — features spanning multiple repos are not supported
- **QA Author code isolation is not a security property** — the agent has Read access to the full codebase and uses the live browser for UI exploration; authoring is grounded in supplied intent plus observed behavior
- **Version test promotion is manual** — promoting version tests to regression is a manual st4ck operation
- **Sequential browser sessions** — parallel QA execution across suites is unverified; falls back to sequential
- **QA Runner requires the `st4ck` CLI** — invoke via `npx st4ck@latest run <test_id> <base_url>` from `Bash`. The runner ships its own Chromium via Playwright (`npx playwright install chromium` if needed). Tests run headed by default.
- **Code Reviewer uses Sonnet** — intentionally hardcoded to `model: sonnet` for consistent code review quality regardless of session model. All other agents inherit the session model.
- **Client write restrictions need host verification** — `tools` / `disallowedTools` behavior can vary by client version, so treat it as a workflow guardrail and verify the target host configuration
- **Supervisor (Phase 1) is manual** — you must run `/supervise` yourself. Phase 2 will add an automated Stop hook.

## License

MIT
