---
name: prd-review
description: Review a Product Requirements Document end-to-end in iterative rounds — self-review + three independent reviewer agents (PO / QA / Dev angles) — and converge when findings reach diminishing returns. Pairs with the `prd-from-source` skill but is reusable for any PRD authored in the file-based, source-grounded shape. Use after a PRD module or set of modules has been authored and before treating it as ready for consumption (test authoring, planning, sign-off).
---

# PRD Review

**Announce at start:** "I'm using the prd-review skill — running self-review, three independent reviewer agents, then a code-extraction pass on deferred gaps and a bug-routing pass on product findings."

The completeness gate for any PRD authored by an agent. **Four phases run in order**, NOT just review-and-stop:

1. **Author self-review** — single pass by the author against the checklist below. Catches obvious gaps; re-anchors the author on audit criteria.
2. **Three-angle independent review** — three reviewer agents (PO / QA / Dev), each briefed for a different audience perspective, working in parallel with no cross-pollination. Iterates until findings reach **diminishing returns**.
3. **Known-gaps-vs-code pass** — for every finding deferred to KNOWN_GAPS, the orchestrator MUST attempt to resolve it from the source code before leaving it deferred. Most "gaps" in a reverse-engineered PRD are gaps in the orchestrator's effort, not gaps in the codebase. Only items that genuinely require human judgment (stakeholder decisions, SLA settings, unbuilt features, copy/design intent) survive as stakeholder questions.
4. **Bug-routing pass** — for every finding describing a real product bug (not a PRD gap), the orchestrator opens a dev task against the correct project. The PRD documents the bug; the dev task tracks the fix.

The orchestrator does NOT stop after phase 2. Stopping there hands the user back a backlog of "deferred to KNOWN_GAPS" items that often have answers in the code. Phases 3 and 4 turn the loop into a closed-loop quality pipeline.

## At the end of phase 4 — the user question

After phases 1–4, present the user with a curated list of **only items genuinely needing human input**: stakeholder product decisions (SLA, security trade-offs, unbuilt-feature intent), sign-off acknowledgments for known operational risks, choices the source code cannot answer (e.g., aspirational vs in-progress future state). Everything else is resolved into the PRD or into dev tasks. The user's remaining job is small and specific.

## When to use

After a module (or full set) has been authored via `prd-from-source` or equivalent. Before promoting the PRD to "ready for test authoring / planning / approved" state. Any time a PRD has been substantially modified and needs re-validation. **DO NOT use** for trivial edits (typo fixes, single-section refactors).

## The three reviewer angles

| Reviewer | Audience perspective | What they look for |
|---|---|---|
| **PO / Stakeholder** | Non-technical product owner confirming the system does what it should | Plain-language clarity, missing scenarios, business logic gaps, role coverage |
| **QA** | Test engineer planning what to cover | Missing "Test implications" sections, untested error paths, vague success states, missing edge cases, untraceable acceptance criteria, state transitions without verifiable side effects |
| **Dev** | Engineer needing to verify or modify the system | Source provenance correctness, missing files in `source:` lists, claims not grounded in cited source, cross-link breakage, decomposition too shallow, dead-code claims |

Each reviewer MUST NOT see the others' reports until they file their own. Parallel dispatch, independent findings.

## The diminishing-returns stopping criterion

Loop runs in **rounds**. Each round: (1) self-review; (2) three reviewers dispatched in parallel; (3) author addresses findings (revises, files `[GAP]`, or rejects with rationale); (4) compute round signal (count + weight new findings).

Stop when: round's findings mostly LOW severity or duplicate prior rounds, AND no CRITICAL/HIGH unaddressed, AND PO reviewer can explain the system to a stakeholder + QA could begin test authoring + Dev says a stranger could implement any leaf from the description alone.

Concretely, **diminishing returns** = round where: < 30% of findings are new, AND average severity below MEDIUM, AND reviewers explicitly note they are "running out of substantive findings."

Typical convergence: 2–4 rounds for a well-authored PRD. First-pass might need 5+.

## Severity scale

| Severity | Meaning |
|---|---|
| **CRITICAL** | Blocks PRD's purpose. Claim contradicts source; security/privacy gate documented wrong; dead-code documented as live; entire user flow missing |
| **HIGH** | Significant gap, must address before sign-off. Missing "Test implications" on a multi-flow leaf; major business rule absent; entity field with business meaning missing |
| **MEDIUM** | Quality issue. Vague language fails Stranger-Implementer Test; cross-link missing; node summary not 2–3 sentences |
| **LOW** | Polish. Inconsistent terminology; minor typo; non-essential detail missing |
| **NIT** | Trivial. Localization gloss for one minor label |

## Architecture: where reviewer behavior lives

The reviewers ARE agents, dispatched by the orchestrator. Two valid architectures:

**Option A — Inline prompts (default).** Orchestrator dispatches `general-purpose` agents with the reviewer prompts inlined from this skill. No custom infrastructure.

**Option B — Custom subagent types (optimization).** Define `prd-reviewer-po`, `prd-reviewer-qa`, `prd-reviewer-dev` under `~/.claude/agents/`. Orchestrator dispatches by name. Benefits: prompt caching across rounds, consistent personality, narrower tool allow-lists. One-time setup cost; worth it for frequent reviews.

Either way, orchestrator logic (when to dispatch, consolidation, diminishing-returns detection) lives in this skill. **This is NOT in AGENTS.md** — AGENTS.md is per-project steering for any agent working in that project.

## Reviewer dispatch — prompt skeletons

Each prompt MUST include the attestation requirement (`prd-from-source` iron rule #4). Dispatch three agents in parallel:

### PO / Stakeholder reviewer

> You are reviewing a PRD as a non-technical Product Owner. The PRD is at `<path>/docs/prd/`. Read every `_index.md` plus every leaf node. For each finding, cite the specific PRD file you read. Focus on: stakeholder understanding without engineering help; role-based behaviors in user terms; business rules in plain language with concrete examples; missing scenarios (especially failure modes); coherent cross-module narrative (role-to-role handoffs as one story).
>
> Report each finding with **severity** (CRITICAL/HIGH/MEDIUM/LOW/NIT), **PRD file path**, **issue in one sentence**, **suggested fix**. Cite source for every claim — if "this is missing", say where you looked and didn't find it. Do NOT blend severities.

### QA reviewer

> You are reviewing a PRD as a QA engineer planning what to test. The PRD is at `<path>/docs/prd/`. Each leaf MUST have a "Test implications" section. Cite specific PRD files. Focus on: every leaf has "Test implications"; state transitions document side effects explicitly; success states are testable (specific, observable assertions); error paths enumerated not handwaved; cross-tenant / cross-company isolation addressed; DB trigger behavior documented with exact firing condition; acceptance criteria can be encoded Given/When/Then.
>
> Report each finding with **severity**, **PRD file path**, **issue in one sentence**, **suggested fix**. Cite source for every claim.

### Dev reviewer

> You are reviewing a PRD as a developer needing to verify the system. The PRD is at `<path>/docs/prd/`. Pick at least 5 random specific claims, **verify each against the cited source files** under the project's source root. For each finding, cite both the PRD file you read AND the source file you checked. Focus on: source provenance correctness (do `source:` paths exist?); body claims hold against cited source; plausible-but-fabricated claims (spot-check ≥5); cross-links resolve; decomposition deep enough to anchor implementation; obvious dead-code claims treated as live.
>
> Report each finding with **severity**, **PRD file path**, **claim being verified**, **source file checked**, **verdict** (CONFIRMED / CONTRADICTED / UNVERIFIABLE), **suggested fix if needed**. Specific. File paths and line numbers.

## Author self-review (before dispatching reviewers)

Catches obvious things cheaply:
- [ ] Every module `_index.md` lists its children explicitly.
- [ ] No `[NEEDS CLARIFICATION]` for things the source answers.
- [ ] Every leaf has "Test implications".
- [ ] Every `source:` path exists.
- [ ] Every `cross_links:` target resolves.
- [ ] Tree depth reaches 3–5 levels on at least some paths.
- [ ] No function names, file paths, or DB column identifiers in MD bodies (only in frontmatter).
- [ ] State machines have explicit allowed-transitions, triggers, side effects.
- [ ] Cross-module reuse: physical reusables in `00_shared/`; cross-module concepts duplicated with cross-links.
- [ ] Each subagent claim spot-checked against at least one source file.

## Resolution loop

After reviewers report, the author makes ONE of four calls per finding:

| Resolution | When | What |
|---|---|---|
| **Accept (PRD fix)** | Correct + documentation gap | Update the PRD node, mark addressed in review log |
| **Accept (bug → dev task)** | Correct + describes broken behavior in running code | Open dev task; document the bug in the PRD with cross-link (PRD captures as-built behavior accurately) |
| **Defer (only if code-unanswerable)** | Correct, source cannot answer, genuinely needs stakeholder | Add to `KNOWN_GAPS.md` with "what's needed". **Re-check during phase 3 before finalizing** — most defers can be resolved by reading more code |
| **Reject** | Incorrect | Document why with cited source evidence; do NOT silently dismiss |

"Defer" is the **rarest** valid resolution. A finding silently dismissed or lazily deferred is a sign the loop isn't healthy.

## Phase 3 — Known-gaps-vs-code pass (MANDATORY anti-laziness check)

Run AFTER review-loop converges, BEFORE telling the user it's done. Per KNOWN_GAPS item: **can the source answer this?**

| Gap type | Code-answerable? |
|---|---|
| Missing decomposition of component/workflow | YES — read the source folder |
| Permission matrix unverified | YES — read element conditions |
| Caller of a workflow unknown | YES — grep pages + reusables + workflows |
| State transition mechanism unclear | YES — grep for the status-setting action |
| Obfuscated option-set codes | YES — grep usage in workflows where code IS readable |
| Field semantics unclear | YES — read data type + grep writers |
| Component layout | YES — read element tree |
| SLA / response time expectations | NO — stakeholder decision |
| Copy / translation | NO — stakeholder/design |
| Whether to fix vs accept | NO — stakeholder |
| Unbuilt feature intent | NO — product |

**For every YES row, orchestrator MUST attempt resolution before finalizing.** 30 minutes of code-reading prevents handing back work the orchestrator could have done. Items genuinely un-code-answerable remain as **stakeholder questions** with "what's needed" — these are what the user sees at end of phase 4.

## Phase 4 — Bug-routing pass

Reviewers + code-extraction surface real product bugs — wrong behaviors in the running system. These belong in a tracked record, **NOT** in KNOWN_GAPS. NEVER silently demote bugs into KNOWN_GAPS as a workaround for missing tooling.

Per bug-shaped finding: (1) **verify against code once more** — quote exact source files and actions producing the broken behavior; (2) **open a tracked record** — server-backed task system (`create_dev_task` / equivalent) against the right project/version OR (offline/st4ck-lite) append to `BUGS.md` at PRD root with `### <title>` + dev-task-shaped body (impact, source files, suggested fix); (3) **cross-link** the bug record back into the PRD node; (4) **the PRD continues to describe the bug** — it captures as-built behavior faithfully; tests assert actual current state; once the bug ships fixed, both PRD + tests update together.

DO NOT open bug records for documentation gaps, missing decomposition, or stakeholder questions.

**Anti-pattern:** putting a real bug into KNOWN_GAPS because `create_dev_task` isn't available. KNOWN_GAPS is for items source can't answer; bugs are items source *did* answer (with broken behavior). Use `BUGS.md` instead.

## Output artifacts

Each round produces: (1) `REVIEW_ROUND_<N>.md` at PRD root — three reviewers' findings verbatim, author's resolution per finding, round signal (counts, severity distribution, diminishing-returns metric); (2) updated PRD nodes per accepted findings; (3) updated `KNOWN_GAPS.md`.

The final round's `REVIEW_ROUND_<N>.md` serves as sign-off record.

## Reviewer independence — practical

Dispatch all three in a single message with multiple parallel Agent tool uses. Same PRD path + same round-N starting state. DO NOT show one reviewer the other's report mid-pass. Consolidate after all three return. If reviewers converge on the same finding, that finding is **doubly weighted** — robust. Single-reviewer findings: evaluate more cautiously.

## When to stop

**Hard stops:** Round 5+ with no CRITICAL/HIGH; round with < 30% new findings + avg severity < MEDIUM; reviewers explicitly state "running out of substantive findings."

**Soft signals:** reviewers repeating same MEDIUM round after round → author not addressing them; pause and ask user to weigh in. Reviewers escalating severity round to round → author over-deferring; revisit.

## Anti-patterns

- ❌ Running only one reviewer angle.
- ❌ Showing reviewer 2 reviewer 1's findings (cross-contamination).
- ❌ Silently dismissing findings without explicit resolution.
- ❌ Chasing LOW findings in early rounds (polish for the final round).
- ❌ Unbounded rounds.
- ❌ Skipping the author self-review.
- ❌ **Stopping after the review loop without phase 3.** Biggest failure mode. User gets handed a "deferred items" list most of which the orchestrator could have resolved.
- ❌ **Letting product bugs sit in the PRD as "known gaps" instead of routing them to dev tasks.** Bugs are not gaps.
