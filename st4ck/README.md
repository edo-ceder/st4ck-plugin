# st4ck Plugin for Claude Code

Role-separated implementation flow for [st4ck](https://st4ck.io) projects — from requirements through code, QA, and delivery.

## What This Plugin Does

A single agent that writes code, creates tests, runs tests, and reviews results cuts corners. This plugin structurally separates those roles:

- **Code Agent** writes code but can't touch tests
- **QA Author** writes tests from specs but can't see implementation code
- **QA Reviewer** independently reviews and signs tests it didn't write
- **QA Runner** executes tests and reports evidence but can't modify anything
- **Code Reviewer** reviews code independently with confidence scoring

Tool restrictions are enforced via Claude Code's agent `tools` / `disallowedTools` frontmatter — not just prompt instructions.

## Prerequisites

### Required
- **st4ck MCP server** must be configured in your project `.mcp.json` or `~/.claude.json`. This plugin cannot configure MCP servers (security restriction for plugins).

  Add to your project's `.mcp.json`:
  ```json
  {
    "mcpServers": {
      "st4ck": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/?apiKey=YOUR_API_KEY"
      },
      "st4ck-qa": {
        "type": "url",
        "url": "https://app.st4ck.io/mcp/v3/?apiKey=YOUR_API_KEY"
      }
    }
  }
  ```

### Recommended
- **agent-browser** or **Playwright MCP** — for QA test execution. Without it, tests are authored but not executed; you'd run them manually.

### Optional
- **context7** — for technology validation during plan authoring
- **Supabase MCP** — for database schema queries during exploration

## Installation

```bash
claude plugin add /path/to/st4ck-plugin
# or from GitHub (when published):
# claude plugin add st4ck/st4ck-plugin
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
- Independent QA review and signing
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

## Agent Architecture

| Agent | Role | Tool Access |
|-------|------|-------------|
| Code Agent | Implement features | `tools`: Edit, Write, Bash, Read, Grep, Glob, LS, Agent |
| Code Reviewer | Independent code review | `tools`: Read, Grep, Glob, LS, Bash |
| Codebase Explorer | Explore and understand code | `tools`: Read, Grep, Glob, LS, Bash |
| Solution Analyst | PO-friendly solution analysis | `tools`: Read, Grep, Glob, LS, Bash |
| QA Author | Write tests from code + running app | `disallowedTools`: Edit, Write, Bash, NotebookEdit |
| QA Reviewer | Review and sign tests | `disallowedTools`: Edit, Write, Bash, NotebookEdit |
| QA Runner | Execute tests, report evidence | `tools`: Read, Grep, Glob, LS + st4ck-qa execution tools + browser |

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

## Known Limitations (v1)

- **Single-project only** — features spanning multiple repos are not supported
- **QA Author code isolation is prompt-based** — the agent has Read access to the full codebase and browser access for UI exploration, but is instructed to default to code (not PRD/specs unless provided)
- **Version test promotion is manual** — promoting version tests to regression is a manual st4ck operation
- **Sequential browser sessions** — parallel QA execution across suites is unverified; falls back to sequential
- **QA Runner requires Playwright MCP** — the runner's tool allowlist uses `mcp__playwright__*` tool names. If you use `agent-browser` instead of Playwright MCP, the runner won't have browser access. Configure Playwright MCP or update the runner's tool list to match your browser automation setup.
- **Code Reviewer uses Sonnet** — intentionally hardcoded to `model: sonnet` for consistent code review quality regardless of session model. All other agents inherit the session model.
- **`disallowedTools` verification needed** — if this field doesn't work for plugin agents, QA Author/Reviewer will need full `tools` allowlists
- **Supervisor (Phase 1) is manual** — you must run `/supervise` yourself. Phase 2 will add an automated Stop hook.

## License

MIT
