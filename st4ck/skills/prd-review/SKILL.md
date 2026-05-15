---
name: prd-review
description: Review a Product Requirements Document end-to-end in iterative rounds — self-review + three independent reviewer agents (PO / QA / Dev angles) — and converge when findings reach diminishing returns. Pairs with the `prd-from-source` skill but is reusable for any PRD authored in the file-based, source-grounded shape. Use after a PRD module or set of modules has been authored and before treating it as ready for consumption (test authoring, planning, sign-off).
---

# PRD Review

**Announce at start:** "I'm using the prd-review skill — running self-review, three independent reviewer agents, then a code-extraction pass on deferred gaps and a bug-routing pass on product findings."

The completeness gate for any PRD authored by an agent. **Four phases run in order**, not just review-and-stop:

1. **Author self-review** — a single pass by the author against the skill's checklist. Catches obvious gaps and re-anchors the author on the audit criteria.
2. **Three-angle independent review** — three reviewer agents (PO / QA / Dev), each briefed for a different audience perspective, working in parallel with no cross-pollination. Run iteratively until findings reach **diminishing returns**.
3. **Known-gaps-vs-code pass** — for every finding deferred to KNOWN_GAPS, the orchestrator MUST attempt to resolve it from the source code before leaving it deferred. Most "gaps" in a reverse-engineered PRD are gaps in the orchestrator's effort, not gaps in the codebase. Only items that genuinely require human judgment (stakeholder decisions, SLA settings, unbuilt features, copy/design intent) survive as stakeholder questions.
4. **Bug-routing pass** — for every finding that describes a real product bug (not a PRD gap — a behavior in the running code that's wrong), the orchestrator opens a dev task against the correct project. The PRD itself documents the bug; the dev task tracks the fix.

The orchestrator does NOT stop after phase 2. Stopping there hands the user back a backlog of "deferred to KNOWN_GAPS" items that often have answers in the code. Phases 3 and 4 turn the review loop into a closed-loop quality pipeline.

## At the end of phase 4 — the user question

After phases 1–4 are complete, the orchestrator presents the user with a curated list of **only the items that genuinely need human input**:

- Stakeholder product decisions (SLA expectations, security trade-off acceptances, unbuilt-feature intent).
- Sign-off acknowledgments for known operational risks the code surfaces.
- Choices that the source code cannot answer (e.g., whether a future state value is aspirational or in-progress).

Everything else has been resolved into the PRD or into dev tasks. The user's remaining job is small and specific — not a stack of "you decide" deferrals.

## When to use

- After a module (or full set of modules) has been authored via `prd-from-source` or equivalent.
- Before promoting the PRD to "ready for test authoring" / "ready for planning" / "approved" state.
- Any time a PRD has been substantially modified and needs re-validation.

**Do not use** for trivial edits (typo fixes, single-section refactors) — that's overkill.

## The three reviewer angles

| Reviewer | Audience perspective | What they look for |
|---|---|---|
| **PO / Stakeholder** | Non-technical product owner reading the PRD to confirm the system does what it should | Plain-language clarity, missing scenarios, business logic gaps, role coverage, "would a user understand this?" |
| **QA** | Test engineer planning what to cover | Missing "Test implications" sections, untested error paths, vague success states, missing edge cases, untraceable acceptance criteria, state transitions that lack verifiable side effects |
| **Dev** | Engineer needing to verify or modify the system | Source provenance correctness, missing files in `source:` lists, claims not grounded in cited source, cross-link breakage, decomposition that's too shallow to anchor implementation work, dead-code claims |

Each reviewer **must not** see the other reviewers' reports until they file their own. Parallel dispatch, independent findings.

## The diminishing-returns stopping criterion

The review loop runs in **rounds**. Each round:
1. Self-review pass (author).
2. Three reviewer agents dispatched in parallel.
3. Author addresses findings (revises PRD, or files `[GAP]` markers, or rejects findings with rationale).
4. Compute the round's signal: count and weight new findings.

Stop when:
- The round's findings are mostly LOW severity or duplicate prior rounds, AND
- No CRITICAL or HIGH severity findings remain unaddressed, AND
- The PO reviewer reports that they could explain the system to a stakeholder, the QA reviewer reports that test authoring could begin, and the Dev reviewer reports that a stranger could implement any leaf node from the description alone.

Concretely, **diminishing returns** means a round where:
- Less than 30% of findings are new (the rest are restatements of prior rounds), AND
- Average severity is below MEDIUM, AND
- Reviewers explicitly note they are "running out of substantive findings".

Typical convergence: 2–4 rounds for a well-authored PRD. A first-pass PRD might need 5+ rounds.

## Severity scale

Reviewers tag each finding with a severity:

| Severity | Meaning | Examples |
|---|---|---|
| **CRITICAL** | Blocks PRD's purpose | Claim contradicts the source; security/privacy gate documented wrong; dead-code documented as live feature; entire user flow missing |
| **HIGH** | Significant gap, must address before sign-off | Missing "Test implications" on a leaf used by multiple flows; major business rule absent; entity field with business meaning missing |
| **MEDIUM** | Quality issue, address in next pass | Vague language fails Stranger-Implementer Test; cross-link missing; node summary not 2–3 sentences |
| **LOW** | Nice-to-have polish | Inconsistent terminology between two nodes; minor typo; non-essential detail missing |
| **NIT** | Trivial | Localization gloss missing for one minor label; example would be nice |

## Architecture: where reviewer behavior lives

The reviewers ARE agents, dispatched by the orchestrator. There are two valid architectures — pick based on how often you'll run reviews:

### Option A — Inline prompts (default)

The orchestrator dispatches generic agents (e.g., `general-purpose`) with the reviewer prompts inlined from this skill. No custom infrastructure. Works out of the box.

### Option B — Custom subagent types (optimization)

Define `prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev` as proper subagent types under `~/.claude/agents/` (or the equivalent for your environment). Each carries its system prompt, tool allow-list, and any model preferences. The orchestrator then dispatches them by name (`Agent(subagent_type: prd-reviewer-po, prompt: <PRD path + round info>)`).

Benefits:
- Prompt caching across rounds and sessions.
- Consistent reviewer personality across orchestrators.
- Tool allow-lists can be narrower (reviewers don't need write access).

Cost: a one-time setup. Worth it if you run PRD reviews more than a handful of times.

This skill provides the prompt templates below — usable inline (Option A) OR as the system prompts for the three subagent types (Option B). Either way, the orchestrator's logic (when to dispatch, how to consolidate, diminishing-returns detection) lives in this skill.

**This is NOT in AGENTS.md.** AGENTS.md is per-project steering for any agent working in that project — it tells agents *what the project is*, not *what the agent's job is*.

## Reviewer dispatch — prompt skeletons

Each reviewer prompt must include the attestation requirement (per the `prd-from-source` skill's iron rule #4). The author dispatches three agents in parallel with prompts like:

### PO / Stakeholder reviewer

> You are reviewing a Product Requirements Document from the perspective of a non-technical Product Owner. The PRD is at `<path>/docs/prd/`. Read every `_index.md` plus every leaf-level node. For each finding, cite the specific PRD file path you read. Focus on:
>
> - Could a stakeholder understand this without engineering help?
> - Are role-based behaviors clearly described in user terms?
> - Are business rules expressed in plain language with concrete examples?
> - Are there scenarios (especially failure modes) the PRD doesn't address?
> - Does the cross-module narrative cohere? (e.g., do the role-to-role handoffs read as one coherent story across modules?)
>
> Report each finding with: **severity** (CRITICAL/HIGH/MEDIUM/LOW/NIT), **PRD file path**, **the issue in one sentence**, **suggested fix**. Cite the source for every claim — if you say "this is missing", say where you looked and didn't find it. Do not blend severities into a single bucket.

### QA reviewer

> You are reviewing a Product Requirements Document from the perspective of a QA engineer planning what to test. The PRD is at `<path>/docs/prd/`. Each leaf node should have a "Test implications" section. For each finding, cite the specific PRD file path you read. Focus on:
>
> - Every leaf node has a "Test implications" section.
> - State transitions document side effects explicitly (not just "and stuff happens").
> - Success states are testable (specific, observable assertions).
> - Error paths are enumerated, not handwaved.
> - Cross-tenant / cross-company isolation scenarios are addressed where relevant.
> - Database trigger behavior is documented with the exact condition that fires it.
> - Acceptance criteria can be encoded as Given/When/Then.
>
> Report each finding with: **severity**, **PRD file path**, **the issue in one sentence**, **suggested fix**. Cite the source for every claim.

### Dev reviewer

> You are reviewing a Product Requirements Document from the perspective of a developer needing to verify the system. The PRD is at `<path>/docs/prd/`. Pick at least 5 random claims that name a specific behavior, file, or workflow, and **verify each against the cited source files** under the project's source root. For each finding, cite both the PRD file path you read AND the source file you checked against. Focus on:
>
> - Source provenance correctness: do the `source:` paths in frontmatter actually exist?
> - Do the body claims hold against the cited source?
> - Are there claims that look plausible but aren't actually in the source? (Spot-check at least 5.)
> - Are cross-links to other PRD nodes valid (the target files exist)?
> - Is the decomposition deep enough to anchor implementation work?
> - Are there obvious dead-code claims being treated as live?
>
> Report each finding with: **severity**, **PRD file path**, **claim being verified**, **source file checked**, **verdict** (CONFIRMED / CONTRADICTED / UNVERIFIABLE), **suggested fix if needed**. Be specific. Cite file paths and line numbers.

## Author self-review (before dispatching reviewers)

Run this pass first — it catches the obvious things and prevents reviewers from spending their attention on low-hanging fruit:

- [ ] Every module's `_index.md` lists its children explicitly.
- [ ] No `[NEEDS CLARIFICATION]` for things the source can answer.
- [ ] Every leaf has a "Test implications" section.
- [ ] Every node's `source:` paths point at files that exist.
- [ ] Every `cross_links:` target resolves to a real PRD file.
- [ ] Tree depth reaches 3–5 levels on at least some paths.
- [ ] No function names, file paths, or DB column identifiers in MD bodies (only in frontmatter).
- [ ] State machines have explicit allowed-transitions, triggers, and side effects.
- [ ] Cross-module reuse rule applied: physical reusables in `00_shared/`, cross-module concepts duplicated with cross-links.
- [ ] Each subagent claim used in authoring has been spot-checked against at least one source file.

## Resolution loop

After reviewers report, the author makes one of four calls per finding:

| Resolution | When | What to do |
|---|---|---|
| **Accept (PRD fix)** | Finding is correct AND it's a documentation gap | Update the PRD node, mark the finding addressed in the review log |
| **Accept (bug → dev task)** | Finding is correct AND it describes a behavior in the running code that's wrong | Open a dev task against the correct project; document the bug in the PRD (with cross-link to the dev task) so the PRD captures the as-built behavior accurately |
| **Defer (only if code-unanswerable)** | Finding is correct, the source code cannot answer it, and it genuinely needs stakeholder input | Add to `KNOWN_GAPS.md` with a clear "what's needed" line. **Re-check during phase 3 before finalizing — most "defer" candidates can be resolved by reading more code.** |
| **Reject** | Finding is incorrect | Document why, with cited source evidence; do NOT silently dismiss |

Note that "Defer" is the **rarest** valid resolution in a reverse-engineered PRD — most apparent gaps are answerable from the source. A finding silently dismissed (or lazily deferred) is a sign the loop isn't healthy — every finding gets one of these four calls explicitly, with the deferral path being the exception, not the default.

## Phase 3 — Known-gaps-vs-code pass (the mandatory anti-laziness check)

**Run this AFTER the review-loop has converged on diminishing returns** — but BEFORE telling the user the work is done.

For each item in KNOWN_GAPS.md, ask: **can the source code answer this?**

| Gap type | Code-answerable? | Examples |
|---|---|---|
| Missing decomposition of a component / workflow | YES — read the source folder | "popup chain not decomposed", "reusable element not walked" |
| Permission matrix unverified | YES — read the element conditions | "Admin vs Editor split is (likely)" |
| Caller of a workflow unknown | YES — grep across pages + reusables + workflows | "who invokes the daily cleanup workflow?" |
| State transition mechanism unclear | YES — grep for the status-setting action | "Submitted → Approved trigger?" |
| Obfuscated option-set codes | YES — grep for usage in workflows where the code IS readable | "only one status value confirmed to be assignable from code" |
| Field semantics unclear | YES — read the data type definition + grep for writers | "is this field still used?" |
| Component layout | YES — read the element tree | "wireframe sketch missing" |
| SLA / response time expectations | NO — stakeholder decision | "support escalation path for a recoverable error state" |
| Copy / translation | NO — stakeholder/design | "localized label for the empty state" |
| Whether to fix vs. accept | NO — stakeholder | "is this behavior intended or a bug?" |
| Unbuilt feature intent | NO — product | "what should the next status transition do?" |

**For every YES row in KNOWN_GAPS, the orchestrator MUST attempt resolution before finalizing.** The reverse-engineering scope is the source — investing 30 minutes of code-reading prevents the user from being handed back work the orchestrator could have done.

Items that genuinely cannot be code-answered remain in KNOWN_GAPS as **stakeholder questions** with a clear "what's needed" line per item. These are what the user sees at the end of phase 4.

## Phase 4 — Bug-routing pass

Reviewers and code-extraction often surface real product bugs — behaviors in the running system that are wrong. These belong in a tracked bug record, **not** in KNOWN_GAPS. Bug findings must never be silently demoted into KNOWN_GAPS as a workaround for missing tooling — see the fallback below.

For each bug-shaped finding:

1. **Verify against code one more time.** A bug claim is only worth filing if the orchestrator can quote the exact source files and actions that produce the broken behavior.
2. **Open a tracked bug record** — pick the right destination based on the environment:
   - **Connected to a server-backed task system** (e.g., st4ck-plugin with `create_dev_task` available, or any equivalent MCP/API tool): open the bug there against the right project / version.
   - **No tracker available** (e.g., running under st4ck-lite, offline, or a local-only setup): append the bug finding to a `BUGS.md` file at the PRD root. One entry per finding, structured like `### <title>` + body matching the dev-task description format (impact, source files, suggested fix). Same cross-link discipline as below.
3. **Cross-link the bug record** back into the PRD node that documents the bug — either the dev-task URL, or a relative path to the `BUGS.md` entry.
4. **The PRD node continues to describe the bug** — it captures the as-built behavior faithfully. Tests written against the PRD assert the actual current state; once the bug ships fixed, both the PRD and the tests get updated together.

Don't open bug records for documentation gaps, missing decomposition, or stakeholder questions. Those aren't bugs in the running system — they're work the orchestrator owes.

**Anti-pattern to watch for:** putting a real bug into KNOWN_GAPS because `create_dev_task` isn't available. KNOWN_GAPS is for items the source can't answer; bugs are items the source *did* answer (with broken behavior). Use `BUGS.md` or the equivalent local file instead — never blur the two.

## Output artifacts

Each review round produces:

1. **`REVIEW_ROUND_<N>.md`** at the PRD root — captures the three reviewers' findings verbatim, the author's resolution call per finding, and the round signal (counts, severity distribution, diminishing-returns metric).
2. **Updated PRD nodes** — modifications applied per accepted findings.
3. **Updated `KNOWN_GAPS.md`** — deferrals accumulated.

The final round's `REVIEW_ROUND_<N>.md` serves as the sign-off record: "the PRD reached diminishing returns at round N with these residual gaps".

## Reviewer independence — practical guidance

The three reviewers must not see each other's findings during their pass. Practically:

- Dispatch all three agents in a single message with **multiple parallel Agent tool uses**.
- Give each agent the exact same PRD path and round-N starting state.
- Do NOT show one reviewer the other's report mid-pass.
- After all three return, consolidate findings into the round's review log.

If reviewers converge on the same finding, that finding is **doubly weighted** — it's been independently surfaced by two audiences, so it's robust. Single-reviewer findings should be evaluated more cautiously (might be that reviewer's idiosyncratic priority).

## When to stop the loop

Hard stops:

- **Round 5+ with no CRITICAL/HIGH findings** — the PRD is done. Sign off.
- **Round where < 30% of findings are new and average severity is below MEDIUM** — done. Sign off.
- **Reviewers explicitly state "running out of substantive findings"** — done.

Soft signals:

- Reviewers repeating the same MEDIUM findings round after round — author isn't addressing them; pause the loop and ask the user to weigh in on the unresolved disagreements.
- Reviewers escalating severity from round to round — usually means the author is over-deferring; revisit.

## Anti-patterns

- ❌ Running only one reviewer angle and declaring the PRD reviewed.
- ❌ Showing reviewer 2 reviewer 1's findings (cross-contamination defeats the purpose).
- ❌ Silently dismissing findings without an explicit resolution.
- ❌ Treating LOW findings as worth chasing in early rounds (they're polish for the final round).
- ❌ Running an unbounded number of rounds — diminishing returns is real; stop.
- ❌ Skipping the author self-review and dispatching reviewers directly — the self-review catches the easy stuff cheaply.
- ❌ **Stopping after the review loop without running phase 3 (code-extraction on Known Gaps).** The biggest failure mode of this skill. The user gets handed back a list of "deferred items" most of which the orchestrator could have resolved with another 30 minutes of source reading. The Known Gaps list should be small and stakeholder-shaped at the end, not a developer-shaped TODO list.
- ❌ **Letting product bugs sit in the PRD as "known gaps" instead of routing them to dev tasks.** Bugs are not gaps. A PRD that accurately documents a bug is doing its job; what's missing is the dev task that tracks the fix. Phase 4 closes that loop.
