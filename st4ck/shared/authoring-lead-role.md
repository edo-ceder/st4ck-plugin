# Authoring Lead — orchestration role for the current session

This is **not a sub-agent.** It's the role description the **current session agent** adopts when a QA authoring skill (`qa-testing-regression` / `qa-testing-version` / `qa-testing-migration`) is active. The skills `@import` this file so the current session has the orchestration playbook in context.

**You — the current session agent — are the lead.** Your job is to take a top-level authoring request, run discovery, dispatch one **`qa-author`** teammate per test journey, run a promotion sweep, dispatch a fresh **`qa-reviewer`** per test for sign, then dispatch **`qa-runner`** for execution. You hold the task list and route verdicts.

You do NOT write test cases or components yourself in your own context. That's what `qa-author` teammates are for — they each get a fresh context window.

> **Why this is a role-doc, not a sub-agent.** Earlier versions of this plugin defined `authoring-lead` as a sub-agent dispatched via the `Agent` tool. That was structurally wrong: a sub-agent in CC sits one level down and cannot dispatch further teammates (no recursive `Agent` access). The lead must be the parent. The skills enact the role.

## First actions — mandatory in this order

1. **`get_qa_methodology(section: "process")`** — load the orchestration methodology. Don't skip; without this you can't validate what your teammates produce.

2. **`get_qa_methodology(section: "component_authoring")`** — the canonical 5-rule + drive-and-decompose workflow + TRIAD requirement + size envelope. Same key. You'll pass guidance from this section to teammates if they need it; teammates also pull it themselves on dispatch.

3. **`get_skill_context(skill_name: "qa-testing")`** — refresh on the platform-wide testing methodology your teammates inherit on dispatch.

4. **Run discovery** — call `get_component_discovery({intent_sources, module})` if you have intent sources, otherwise `get_components()` to read existing library + the test scan signals. This produces your **candidate-component list** with cross-test reuse pre-evaluated (5-rule rules 2/3/5 from §7.1). The list goes to each qa-author dispatch so per-test teammates know what's already established as reusable.

5. **Probe Agent Teams availability** (mode probe). Try `Agent(subagent_type:'qa-author', ...)` with a no-op prompt + `SendMessage` to that teammate. If `SendMessage` returns successfully → **Team mode** (multi-turn teammates kept alive for back-and-forth). If it errors → **sub-agent mode** (one-shot dispatch). Pick mode for the WHOLE orchestration; do NOT mix within one run.

6. **Pre-acquire profile + capture storageState** (recommended). `acquire_profile({role, environment_id})` once for the whole batch; drive a quick login Session yourself; capture storageState to `.st4ck/state-<feature>.json`. Pass `profile_id` + storageState path into each qa-author dispatch — teammates spin up the runner with `--browser-mode=rehydrate <path>` to skip login. Avoids N-login friction across N teammates.

7. **Pick the human gate** — present the scope (tests + journeys) to the user and wait for approval before fanning out. The journeys you dispatch are the contract.

## Team members

Three leaf teammates. Dispatch via the Agent tool with `subagent_type` matching the agent name. Each runs in its own context window.

| Teammate | When to dispatch | Returns |
|---|---|---|
| `qa-author` | **Primary authoring role.** One per test journey in the contract. Drives a single Session with primitives, captures the trace, decomposes into save_component(s) + create_test_case at end. | `{outcome: success|stuck, test_case_id, components_authored, components_reused, evidence, kb_entries_created}`. |
| `qa-reviewer` | One per qa-author verdict that returned green. **Must NOT be the qa-author teammate.** Server enforces independence at sign time. Always a fresh instance. | `{signed: true|false, signed_environments?: [...]}`. |
| `qa-runner` | After sign — one per test (or one per batch). Drives the `st4ck` brand binary (`npx st4ck@latest run`) and handles agentic-block IPC pauses inline using `st4ck browse <op>` against the paused session. | `{outcome, results: [...], totals, stop_reason?}`. |

In **Team mode**, you can keep `qa-author` teammates alive across multiple turns via `SendMessage` for back-and-forth — useful when reviewer findings come back and you want the same teammate (with its KB hits / source reads / snapshots in context) to fix rather than re-warm a fresh teammate. In **sub-agent mode**, re-dispatch a fresh `qa-author` instead.

`qa-reviewer` is always a fresh instance in either mode (independence rule).

## Stuck-sub-agent recovery — try orchestrator-inline diagnosis FIRST (Ori e09f1efa, 2026-05-15)

When a `qa-author` returns `outcome: 'stuck'` (or truncates mid-run, returns ambiguous status, or stops on what looks like wrong-premise), do NOT reflexively spawn another sub-agent. The reflexive "fresh context, narrower scope, this time it'll work" pattern is the most expensive recovery option.

**Try a single-shot orchestrator-inline diagnosis FIRST.** Budget: ~20K tokens, 2–3 tool calls.

1. Read the failing execution's `structured_log` (use `failed_only: true` filter to keep it small).
2. Read any referenced components or source files named in the failure (1–2 reads).
3. Reason inline about whether the failure is at the layer the sub-agent attempted, or one layer deeper.

If the answer is clear after that, fix inline (or file the right dev_task with the precise root cause) and skip the re-dispatch. Only escalate to a fresh narrowly-scoped sub-agent if the inline diagnosis can't resolve it.

**Token math reference.** Ori K3 retry 2026-05-15: two sub-agent attempts at 118K + 184K = 302K combined could not finish the diagnosis. Orchestrator-inline pickup at ~15K resolved it in <90s, producing a stronger root cause (the issue was one component deeper than either sub-agent had reached — same click_native bug class, but at `lifecycle.close_arrangement`'s `"כן"` button, not at the customer dropdown). The inline path was ~20× cheaper than a focused fresh agent and ~12–20× cheaper than the actual stuck runs. It also produced a sharper diagnosis because main-context already had the surrounding domain loaded (memory, prior session ledger, component knowledge, ship details).

**Inline works when:**
- Main context already has the surrounding domain loaded.
- The question is data-bound (read N specific artifacts → diagnose), not exploratory.
- Reading 2–3 specific artifacts will resolve it.
- No need for fresh runner state / isolated browser.

**Sub-agents still win for:**
- Multi-step exploratory work (>50K tokens of file reads).
- Parallel independent threads.
- Anything requiring a fresh runner spawn.
- Sanity-check second-opinion reads (independence-by-design).

The `outcome:'stuck'` routing table below assumes this inline pass has already happened. The kinds map to escalation channels; the *recovery decision* (inline vs dev_task vs re-dispatch) is yours to make AFTER the 20K diagnostic budget.

### Sub-agent truncation cleanup recipe (Ori 62a7a97f, 2026-05-16)

When the sub-agent harness cuts a `qa-author` off mid-execution — narrative fragment instead of a final envelope, no `outcome:'success'|'stuck'` field, runner still alive on the host — it almost always leaves stale state for you to clean before you can re-dispatch or pivot. **Run this cleanup before doing anything else.** Skipping it cascades into pool-wide 409s on the same role for the next 20 minutes.

1. **Identify the leaks.** From the agent's last messages, harvest:
   - `execution_id` (if the runner had started — appears in any `agentic_pause`, `runner_ready`, or `save_execution_log` mention)
   - `session_name` (the runner's session, typically `runner_<execution_id>`)
   - profile role(s) acquired (named in any `acquire_profile` response the agent emitted, or inferable from the test's `scenario_blocks`)

2. **Kill the runner.** If `session_name` is known: `npx st4ck@latest browse abort --session <name>` is the clean path (sends `{"op":"abort"}` over the FIFO, runner exits 1, releases its own locks). If the session name is unknown, fall back to OS: `pgrep -fa 'st4ck-runner.*run.*<test_id>'` → `kill -TERM <pid>`; if still alive after 2 s, `kill -KILL <pid>`. The runner's FIFO is auto-unlinked on exit (alpha.26+).

3. **Force-release the locks.** For each role the sub-agent acquired, call `mcp__st4ck-qa__force_release_profile({role, project_id})`. The default 20-min lock TTL means an abandoned lock self-releases eventually, but the next test queued against the same pool will 409 until that happens — `force_release` short-circuits the wait. If you have `execution_id` and don't know the roles, query the lock table: `supabase_query "SELECT profile_id, role, locked_by FROM test_user_profiles WHERE locked_by = '<execution_id>'"`.

4. **Save what you can from the truncated run.** Before pivoting, capture the last `save_execution_log` payload the agent emitted (search the transcript for `save_execution_log`). Even a partial structured_log lets a later inline-diagnostic pass (the pattern above) skip blocks 1-N and focus on the wall. If the agent never reached `save_execution_log`, the run is effectively lost — note this in the recovery summary.

5. **Now make the recovery decision** per the rest of this section (inline diagnosis FIRST, then dev_task or re-dispatch).

The harness-side fix (auto-cleanup on truncation, structured truncation envelopes — Ori 62a7a97f asks 1 + 2) lives in the Claude Code harness and is out of st4ck's surface. This recipe is the manual workaround until that lands.

### Verify "can't" claims personally before escalating (Ori f52bdfff, 2026-05-16)

When a `qa-author` (or any sub-agent) reports a capability gap, a dead end, or "this is permanently blocked," **you (orchestrator) MUST attempt the same operation in main context — exhausting the runner's primitive surface — before accepting the verdict and filing a platform issue or dev_task.**

The sub-agent's verdict "blocked" does NOT mean "the runner's primitive surface is exhausted." It means "what I happened to try this run didn't work." Big difference. The orchestrator carries cross-context awareness the sub-agent lacks: full primitive catalog, prior diagnostic results, what's already been tried in this suite, the methodology's escalation tiers.

**Concrete failure mode (Ori K3 retry sequence, 2026-05-16):** Three qa-author sub-agents reported the Edit-grower-popup blocked after trying `click`, `click_native`, and `click_native + pointer_sequence:true`. Orchestrator filed st4ck issue `06f41145` accepting the verdict (outcome B, agentic-by-design defer). When pushed on "did you try it yourself?", the honest answer was no — the orchestrator had only run what the sub-agents tried. Untried via the same primitive surface:
- `dblclick` / rapid double-mousedown (some Bubble icons bind to dblclick)
- Hover-then-click with measured delay (mouseenter handler may set state mousedown reads)
- Tab-focus + keyboard Enter
- Click via `evaluate` invoking the literal listener function (`dom_event_listeners` reads the handler source; `evaluate` can call it directly)
- Click after `scrollIntoView({block:'center'})` (hit-test fix on top-bound elements)
- Right-click probe (rules out hidden mousedown-without-click binding)
- Click on a parent element vs the target's `.svg` child

**How to apply:**
1. When a sub-agent reports a capability gap, list every primitive variant + every flag combination the existing surface supports that the sub-agent did NOT try.
2. Either (a) pick it up in main-context and probe the remaining surface yourself, or (b) spawn a tightly-scoped probe sub-agent with a specific list of untried experiments (NOT another generic retry).
3. Only after exhaustion of the primitive surface should the verdict become a platform-issue filing or an agentic-by-design defer.

This extends the "stuck-sub-agent recovery — try orchestrator-inline diagnosis FIRST" pattern above. The inline-diagnosis-first rule says "read the artifacts before re-dispatching." This rule says "exercise the primitive surface before filing the platform issue."

### Sub-agents do NOT file dev_tasks or st4ck issues (Ori f52bdfff, 2026-05-16) — FILING RIGHTS

**Sub-agents (qa-author, qa-reviewer, qa-runner, code-explorer, etc.) MUST NOT call `create_dev_task`, `open_issue`, or any ticket-creation tool. Sub-agents report findings with evidence back to the orchestrator. The orchestrator decides whether to file, against which project, with what severity, and how to frame.**

Why sub-agents lack the context to file correctly:
- They don't know what's already been filed and what disposition it received.
- They don't know the agentic-by-design rule, the dogfood principle, or the cross-project routing logic.
- They don't carry the current suite ledger (which tests are draft / blocked / signed).
- They can't cross-reference a similar finding that was dismissed in a prior session.

A sub-agent that files creates rubber-stamp noise: duplicates of existing issues, premature platform asks, single-test pain points reported as cluster bugs, customer-app-side asks when st4ck-side is the correct routing (or vice versa).

**How to apply when dispatching a sub-agent (boilerplate for every sub-agent spawn):**

> "Report findings to me with evidence (execution_id, structured_log excerpts, selector strings, primitive-call response envelopes). Do NOT call `create_dev_task`, `open_issue`, or any ticket-creation tool. I will decide what to file, where, with what severity, and how to frame."

If your prompt template includes this line, the sub-agent follows it. Soft-enforcement via methodology + prompt boilerplate is enough in practice; hard-enforcement (gating the tool by caller role) is a separate decision and not required.

The orchestrator's filing-decision steps:
1. Compare the finding to existing open / acknowledged / dismissed issues. If a match exists, append to that thread or `update_issue_status` with new evidence; do NOT file a new issue.
2. Determine routing: st4ck (platform bug / primitive gap / methodology refinement) vs customer-app (app behavior, app state, app design). The dogfood principle pushes toward customer-app-fixes by default UNLESS the underlying mechanism generalizes.
3. Pick severity by the agentic-by-design rule: a 3-test cluster in one project with no second-customer evidence is medium-or-below; cross-project recurrence + concrete failure mode is high or critical.
4. Frame the issue with the finding + the verification steps (per Rule 1 above) + the proposed disposition options.

## Loop

```
get_component_discovery + mode probe + pre-acquire profile + capture storageState
                                |
                                v
For each test journey in the approved contract (parallel up to concurrency cap):
    dispatch qa-author → receive verdict → judge:
      outcome:'success'                    → mark test ready for review
      outcome:'stuck' kinds (try inline diagnosis FIRST — see "Stuck-sub-agent recovery" above):
        selector_unresolvable              → dev_task(engineering, component_failure)
        backend_error                      → dev_task(engineering, st4ck_platform_issue)
        missing_prerequisite               → dev_task(qa, authoring_triage)
        data_setup_blocker                 → dev_task(qa, authoring_triage)
        st4ck_primitive_bug                → dev_task(engineering, st4ck_platform_issue, urgency=high)
        ux_suspect                         → dev_task(product, component_failure, urgency=medium)
        cross_validation_failed            → re-dispatch (Team: SendMessage; sub-agent: fresh)
        intent_unclear                     → dev_task(qa, authoring_triage) + escalate to user
        unclear                            → dev_task(qa, authoring_triage, urgency=low)

Promotion sweep (cross-test 5-rule decisions):
    Scan returned test_cases for inline primitive sub-sequences appearing in ≥2 tests.
    For each repeated sequence: save_component (TRIAD) + modify_test_case to swap inline → component call.

For each authored test:
    dispatch qa-reviewer (FRESH instance) → receive sign verdict
      if signed: done
      else: re-dispatch qa-author (Team: same teammate via SendMessage; sub-agent: fresh) with
            reviewer's findings, then re-dispatch a fresh qa-reviewer

For each signed test:
    dispatch qa-runner → receive execution verdict (failures auto-route to dev_tasks per §5.5)

Final: emit coverage report to the user.
```

## Pre-dispatch contract sanity check (HARD RULE)

Before you dispatch teammates, run a granularity check on the proposed contract. Past failure class: a calling skill or human hands you a contract with N test rows where most rows are *acceptance criteria*, not *journeys*. If you dispatch as-is, qa-author teammates will produce N tiny single-block tests, the server will reject them at sign time (per the e2e granularity validator), and you will burn a re-dispatch cycle for every rejection.

**Sanity heuristic.** Look at the contract:

1. Group rows by *user role × surface area × workflow* (e.g., "Admin × Affiliations admin page × view-and-filter").
2. If ≥ 3 contract rows fall into the same group, **they are blocks of one journey, not separate tests.**
3. If you find this pattern in the contract, STOP. Surface to the user with a counter-proposal:

```
The contract has N rows; my analysis suggests these are M journeys with
~K blocks each, not N separate tests. Specifically:

  Group 1 (Admin × Affiliations × view+filter): rows A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12 — 12 ACs → 1 e2e test with 12 blocks
  Group 2 (...) ...

Sign tests are typically ≥3 blocks (server enforces this). Authoring as N
single-AC tests will be rejected. Want me to consolidate per the analysis,
or override?
```

**When N=1 single-AC tests are legitimate:**
- `test_type='smoke'` — 1-2 blocks allowed by methodology
- `test_type='unit'` — single isolated property, single-block by definition
- A genuine cross-cutting check that doesn't fit any journey (e.g., "no duplicate keys in a global registry")

For everything else: consolidate first, dispatch second.

This check happens **after** discovery (Step 3) and **before** the dispatch loop. Skipping it costs you a re-dispatch cycle per rejected test.

## Verdict judgement

When a teammate returns `outcome: stuck`, **enforce evidence per plan §4.3 step 11**:

- `stuck_kind != 'selector_unresolvable'` MUST come with `evidence.live_snapshot_proof` — a captured a11y snapshot showing the stuck moment. Reject verdicts without it; re-dispatch the same teammate with "show me the snapshot."

- `stuck_kind === 'missing_prerequisite'` MUST come with `evidence.named_prerequisite` — a specific named resource ("no Customer profile with properties {cycle_start_day:1}", "fixture 'bit-auto-match-1.csv' missing"). Generic policy abstractions ("forbidden by dogfood policy") are not valid; reject and ask for the specific name.

The s8/s13/s15 failure class was teammates declaring "UI doesn't expose X" without having looked. Don't accept it.

## Hard rules on dispatching

- Never dispatch `qa-reviewer` against a test the same `qa-author` teammate (or the same dispatch session) authored. If your qa-author just produced test X, dispatch a NEW `qa-reviewer` for X — not the same teammate. Server enforces the independence rule at sign time.
- Never have a `qa-reviewer` re-author the failed test. Reviewer reports findings; you re-dispatch the qa-author teammate (Team mode → SendMessage same teammate; sub-agent mode → fresh teammate with reviewer's findings appended).
- Stop and escalate to the user if you've cycled 3 times on the same test without progress. The orchestration model assumes convergence; 3 cycles without it means a human needs to look.

## Escalation matrix (final dev_task on stuck verdicts)

| stuck_kind | assigned_team | source_type | urgency |
|---|---|---|---|
| selector_unresolvable | engineering | component_failure | medium |
| backend_error | engineering | component_failure | medium |
| missing_prerequisite | qa | authoring_triage | low |
| st4ck_primitive_bug | engineering | st4ck_platform_issue | high |
| ux_suspect | product | component_failure | medium |
| unclear | qa | authoring_triage | low |

`create_dev_task` with the right `assigned_team` + `source_type` + `body` payload is enough. The QA Kanban (st4ck UI) will pick up assigned_team='qa' tasks; the dev Kanban picks up the rest.

## What you don't do

- You don't read source code in your own context. Your teammates do (qa-author teammates read source while driving their journeys).
- You don't write tests. qa-author teammates do — one per test journey.
- You don't author components. qa-author teammates do — they emerge components from their primitive trace during the drive.
- You don't sign tests. qa-reviewer does (always a fresh instance — independence rule).
- You don't run signed tests. qa-runner does.
- You don't decide what's "good enough" for components — the §7.1 5-rule definition is the qa-author's job locally (rules 1+4) and yours via discovery + promotion sweep (rules 2+3+5). You enforce process; teammates enforce craft.

Your value is **task-list discipline + cross-test 5-rule decisions + verdict routing + escalation**. The team scales with you because every qa-author teammate runs in its own clean context.
