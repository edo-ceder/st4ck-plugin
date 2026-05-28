---
name: prd-from-source
description: Author a Product Requirements Document from an existing codebase, code export, or unpacked low-code project — by reading source rather than asking the user. Use when the user wants a PRD generated from imported elements, exported builders (Bubble, Webflow, Retool), screen recordings, or any "code-first" reverse-engineering of intent. Self-contained — bundles its foundational PRD-authoring rules so it works with or without a server connection.
---

# PRD From Source

**Announce at start:** "I'm using the prd-from-source skill — authoring a PRD by reading the codebase rather than asking the user."

A PRD authoring skill grounded in the **spec-driven development** consensus (GitHub Spec Kit, AWS Kiro, Reversa, OpenSpec, AGENTS.md). PRDs authored here are: read-by-source, not asked-of-humans; three-audience (non-technical stakeholders, QA, devs); file-based Markdown + YAML frontmatter, one node per file; machine-parseable with stable IDs and confidence markers; verifiable (every claim cites its source).

## When to use

- The user wants a PRD for a system whose source already exists (running code, exported builder, unpacked low-code).
- A test-authoring / QA effort needs an intent layer the code doesn't formally have.
- A migration / re-platforming requires capturing as-built behavior before re-implementing.
- An agentic coding workflow needs a spec layer to anchor implementation, planning, review.

**DO NOT use** when *designing* a new feature from scratch — use a requirements/discovery skill instead.

## Foundational rules

### The Rebuild Test

Every PRD node MUST pass this: could a developer who has never seen this application implement exactly this feature from your description alone — no source code, no PO, no designer? Anything they'd need to guess = a question they cannot answer; a vague description = a feature they will build wrong.

### Tree structure

Hierarchy, target depth 4–5 levels:

```
root → module → screen / entity / user_flow / backend_flow / business_rule / integration
     → component / field / logic / validation / endpoint / error_state / element / button
```

- Create parents before children. Parent content = 2–3 sentence overview; all detail in children.
- A node with rich detail MUST be decomposed — never one long document at the parent.

### Decomposition rules

| Parent type | Required children |
|---|---|
| **Screen** | One `component` per distinct UI section (header, form, table, sidebar, modal). One `element` per non-obvious interactive element. |
| **Entity** | One `field` per non-trivial field — type, constraints, defaults, validation. Skip boilerplate (id, created_at, updated_at, deleted_at). |
| **User flow** | One `logic` per major step. One `error_state` per distinct failure path. |
| **Backend flow** | One `logic` per processing stage. One `validation` per input guard. One `endpoint` if it exposes an API. |
| **Business rule** | One `validation` per distinct condition. One `error_state` per exception. |
| **Integration** | One `endpoint` per call direction (inbound / outbound). |

### Node types (most specific)

- **Structural:** `root`, `overview`, `module`, `subsystem`.
- **Feature-level:** `screen`, `section`, `user_flow`, `backend_flow`, `entity`, `business_rule`, `integration`, `process`.
- **Detail-level:** `component`, `element`, `field`, `button`, `logic`, `validation`, `error_state`, `endpoint`.

### Cross-link types

`calls_endpoint`, `uses_entity`, `enforces_rule`, `triggers_flow`, `depends_on`, `related_to`, `validates_with`, `redirects_to`. Cross-link screens ↔ entities, flows ↔ rules, endpoints ↔ flows.

### Content quality

Product document. What the software DOES, not how it's built:
- ❌ "The `useAdvisor()` hook checks `isAdvisor === true` and renders `AdvisorBanner`"
- ✅ "When a financial advisor logs in, the system displays a banner indicating they are viewing a client's data"

Rules: NO function/variable/component/class names or file paths in the body. Name UI fields as the user sees them (the label, not the DB column). Plain-language validation. Quote error messages exactly as the user reads them. Be specific — vague statements fail the Rebuild Test.

### Verification against source code

1. **Read the actual code** — NEVER document based on README / comments / docstrings alone. Comments lie, code doesn't.
2. **Verify connectivity** — a backend service that exists but isn't wired to any active route or frontend component is currently unused. Document as deprecated/legacy.
3. **Trace end-to-end** — confirm UI element → API call → handler → service → DB. Any link broken = feature not active.
4. **Prune unused features** — disconnected services go under "Deprecated & Legacy", not active modules.
5. **Verify numbers** — count tables/routes/endpoints yourself. Don't copy stale numbers from existing docs.

(Self-review checklist for declaring a module complete: see § Self-review checklist below.)

## Phase 0 — Preliminaries (MANDATORY before walking any source)

A PRD without an anchor produces garbled assumptions from raw code reading. Four checks before opening the first source file. 5 minutes total; saves hours of misinterpretation.

### 0.1 — User-role taxonomy in st4ck

If connected to st4ck (orchestrator has `mcp__st4ck-pm__*` or `mcp__st4ck-dev__*`):

```
get_project_users()      # lists project_users / user types with roles, permissions, descriptions
get_project_briefing()   # one-liner about the app + recent versions
```

Non-empty taxonomy → **use as the role anchor for the whole PRD**. Every `user_role_ids:`, every state-machine role binding, every privacy rule cites these by name. Don't reinvent IDs from option-sets; reconcile both. Empty / no st4ck → 0.2.

### 0.2 — Ask the **app context** (5 questions, ~60 seconds)

Higher frame before role taxonomy: **what kind of app is this, who's it for, how does it differ from generic SaaS?** These decide rigor for the whole PRD.

1. **Purpose** — one sentence (e.g., "scheduling for clinic appointments").
2. **Type** — *Business-specific (private/internal)* / *vertical SaaS* / *horizontal SaaS* / *internal tools* / *consumer*.
3. **Audience** — concrete numbers (e.g., "~10 operator staff + ~50 supplier partners + ~200 buyer companies").
4. **Deployment** — single-tenant private install / multi-tenant SaaS / hybrid.
5. **Language posture** — single-language no localization / multi-language formal translation / single now translation later.

**Business-specific + single tenant + single language** → PRD can skip i18n testing, translation completeness, public-sign-up SLA, multi-tenant security as "attacker defense" (still test isolation, but accepted-as-design rather than threat-modeled). Edge cases that "wouldn't happen with these users" can be marked accepted operational behavior. **SaaS + multi-tenant + multi-language** → all of the above MATTER. Cross-tenant isolation is defense-against-strangers. Translation completeness gates release. Edge cases are paying customers — same finding is a real bug.

### 0.3 — Role taxonomy + primary lifecycle (after 0.2)

6. **Full role list** — every user type with own access surface: name, one-line purpose, scope (tenant vs cross-tenant), headcount.
7. **Primary workflow / lifecycle** — recurring journey the app exists to support.
8. **Key entities (nouns)**.
9. **Tech stack / source shape** — live code / exported builder / screen recordings? Determines file shapes.

### 0.4 — Other documentation

Existing artifacts usually richer than code: old PRDs, design docs, wireframes, diagrams; Slack/meeting decisions; customer-facing help pages (often most accurate); existing spec/ADR docs. Ask explicitly: *"Do you have any other documentation you'd like to use as input for this PRD pass?"* — users forget they have these. Treat extras as **hints, not source of truth** (code still wins per Iron Rule #1).

### Ask all questions in ONE message

DO NOT ping nine times. Send all of 0.2 + 0.3 + 0.4 in a single message — 60-second answer for the user, and the orchestrator's rigor framing comes from these. **Biggest Phase 0 anti-pattern: making the user feel a long discussion is starting.** It isn't.

### Phase 0 output

Short anchor block in PRD root `_index.md` BEFORE authoring modules: app in one sentence + type + audience + deployment + language posture; role taxonomy; primary lifecycle; key-entity list; source shape; additional input docs; **"PRD rigor frame"** — what gets tested rigorously, what gets accepted as operational/informal, what's out of scope (derived from 0.2).

Pass 1 (mechanical scaffold) and Pass 2 (curated intent) follow.

## Four iron rules

### 1. Code is the spec.

A product question the running code answers is not a question — it is a fact waiting to be read. Default move for an apparent clarification:

1. Read the source file you cited.
2. Read the sidecar metadata (`.meta.json`, AST dump, raw export blob) for operators or attributes the human-readable summary stripped (list operators like `add`/`remove`, condition values referencing internal codes).
3. Query live data via MCP (`*_get_schema`, `*_describe_table`, `*_query`).
4. **Only then** draft a `[NEEDS CLARIFICATION]` — for genuinely-unanswerable-from-code things only (untranslated copy, design intent for an empty state, business decisions on un-built features).

#### Call out unused / aspirational / dead code without hedging

When code shows something is never called, never set, never reached: **state it plainly**. DO NOT soften "dead code" to "might be unused" or "needs verification". The grep result IS the verification. Confident findings can be reviewed and corrected; hedged findings cannot be acted on.

See `EXAMPLES.md` § "Dead-code phrasing table" for the canonical phrasings.

### 2. Cite your sources — always.

Three confidence markers (Reversa-inspired):
- **`[CONFIRMED: <src>]`** — directly observable in cited source. Default.
- **`[INFERRED: <src>]`** — reasonable read involving judgment (e.g., interpreting an option-set's intended meaning from workflow usage when the option set itself is opaque).
- **`[GAP]`** — source silent/ambiguous. Used sparingly with a concrete question for the next pass.

Source paths go in frontmatter `source:` list. Inline `[src: <path>]` for specific disputed claims.

### 3. Memory is a hint, not a source.

Persistent memory (prior conversation notes, auto-memory, briefings): treat as **hint about where to look**, not ground truth. Verify every claim against current code. Memory may be from failed prior attempts. Memory naming an identifier (function, table, status) — confirm it still exists.

### 4. Subagent reports must be attested.

Dispatching a subagent (Explore, Plan, research) to read code: **require citation of specific file paths (and line numbers) for every non-trivial claim**. Subagent returning "the page has 11 tabs" without citing the files = un-auditable; treat as hint. **Spot-check at least one claim per subagent return.** If it holds, the rest is probably OK; if not, demand attestation for everything.

Good dispatch prompt always includes: *"For each claim, cite the specific file path under the source root where you read it. If you cannot cite a file, mark `[INFERRED]` or `[GAP]`. Do NOT blend confirmed and inferred claims as the same."*

This is the single biggest mitigation against subagent hallucinations.

## Two-pass approach

**Pass 1 — mechanical scaffold.** One PRD node per first-class artifact with 2–3 sentence overview: one entity per data type / table; one screen per page / route; one backend flow per server-side workflow / function / handler; one option-set / enum captured as a referenced concept. Fast, complete, flat re-encoding. **Low test signal on its own** — but it's the skeleton.

**Pass 2 — curated intent.** Walk same artifacts; add what source does NOT encode: user flows traversing multiple screens/handlers; business rules from condition expressions, status state machines, privacy/auth gates; cross-links screens ↔ entities, flows ↔ rules, rules ↔ entities; role bindings (`user_role_ids`) where role matters. **Pass 2 is where PRD becomes useful for test authoring.**

## File-based authoring shape

Author as Markdown under `<project>/<path>/docs/prd/`. One MD file per node. A future importer walks the tree and calls DB writes. Folder layout, frontmatter schema, content rules, stable-ID conventions, cross-module reuse pattern: see `EXAMPLES.md` § "File-based authoring shape".

## Audience triple-target

Every node readable by all three: **Non-technical stakeholder** (plain English / native UI language; body prose; UI labels with translation glosses; observable behavior). **QA engineer** (test preconditions, success states, error paths; "Test implications" section on every leaf; state machines with explicit transitions + side effects). **Developer** (source provenance for ground-truth verification; decomposition deep enough to anchor tests on specific UI surfaces; `source:` frontmatter; tree depth 3–5 levels; cross-links).

## Stranger-Implementer Test

Per leaf: **could a stranger (no source code, no PO, no designer) implement exactly this piece from this node alone?** Anything they'd need to guess = incomplete. Industry equivalent: "Rebuild Test", "completeness check", "self-sufficiency test".

## Working with exported / unpacked codebases

Many low-code exports = `.md` body for humans + `.meta.json` (or similar) sidecar for raw builder data. **Always check both.** Some critical facts live ONLY in the sidecar (list operators `add`/`remove`/`set`; conditional bindings to roles/option-sets; obfuscated `db_value`/IDs). **When a sidecar exists, treat MD as "the index" and JSON as "the truth".** Disagreement → JSON wins.

Common export quirks + the internal-code anti-pattern: see `EXAMPLES.md` § "Export quirks" + § "Internal-code anti-pattern".

## AGENTS.md companion — operational only

Per the [AGENTS.md convention](https://agents.md/), a project with a PRD should also have project-root `AGENTS.md`. **AGENTS.md and the PRD have non-overlapping purposes**:

| Belongs in AGENTS.md | Belongs in the PRD |
|---|---|
| Where files live | What the product does |
| Build / test / run commands | Entities, flows, business rules |
| Code conventions, naming, style | State machines |
| Always / Ask first / Never operational tiers | Security findings, dead code |
| Which MCP tools / skills are wired up | Stakeholder questions |
| A pointer to the PRD root | Cross-tenant isolation rules |

**Rule:** product running = PRD. How to work in this repo as an agent = AGENTS.md.

Why this matters: AGENTS.md has no update mechanism tied to product changes. Workflow behavior changes → PRD update is part of the change; AGENTS.md sits next to repo root and tends to rot. **Never let AGENTS.md own product knowledge in the first place.** A good AGENTS.md after a PRD pass is ~50–100 lines. Longer = bleeding PRD content into a file with no update mechanism.

## Live-data MCP tools (when available)

`*_get_schema`, `*_list_records`, `*_describe_table`, `*_query` — preferred over re-deriving schema from an export. Use them to resolve any export ambiguity (obfuscated values, "is this field still used", row counts). Export → PRD is a translation; translations drop information. Live data is the closest thing to source of truth.

## Self-review checklist (before declaring a module complete)

- [ ] Every parent node has children (not just a single MD blob).
- [ ] Tree depth 3–5 levels, not flat root → module.
- [ ] No `[NEEDS CLARIFICATION]` for things code answers.
- [ ] All counts/statistics verified (every quoted number actually counted).
- [ ] No function names, file paths, or DB column names leaked into MD bodies.
- [ ] Cross-links resolve to real PRD nodes.
- [ ] Every `source:` path points at files that exist.
- [ ] Every leaf has a "Test implications" section.
- [ ] A stranger reading any leaf could implement that specific piece without guessing.
- [ ] At least one claim per subagent report spot-checked against source.

## Anti-patterns

- ❌ "This needs business sign-off" for code-discoverable behavior. If running a year, the behavior IS the decision.
- ❌ Citing memory or prior docs as fact.
- ❌ Trusting schema-extraction artifacts as complete.
- ❌ Describing UI mechanics from intuition.
- ❌ Trusting subagent reports without spot-checking.
- ❌ Writing 100 PRD nodes at once without checkpoint.
- ❌ Designing for "the importer" before one exists.
- ❌ Decoding obfuscated internal identifiers when the user-facing label is right there. PRD says "status moves to Submitted" — not "status moves to `____________`".

## Working order

1. **Phase 0** (mandatory). `get_project_users` if connected; else ask user for role taxonomy + app anchor. Ask about other documentation. Write anchor block to PRD root.
2. Re-read **Foundational rules** so taxonomy, decomposition, Rebuild Test are loaded.
3. Walk source root, list modules. Identify physically shared artifacts → `00_shared/`.
4. Pick ONE module. Mechanical scaffold (Pass 1) + curated intent (Pass 2). STOP.
5. User reviews module N. Adjust shape. Then proceed to module N+1.
6. After all modules: hand off to `prd-review` skill for the four-phase review pipeline.
7. Emit/update project-root `AGENTS.md` — operational steering only.
8. Resist refactoring the format mid-build. Lock the shape on module 1.

## Distinction — PRD vs Spec vs ADR vs Plan

**PRD** (this skill) = *intent + behavior* (what / for whom / why). **Spec** = precise contract for *how* it's built (derived from a PRD requirement). **ADR** = *why we chose this approach* (standalone, cross-cutting). **Plan / Tasks** = *sequenced steps* to implement (derived from a spec). A PRD-from-source pass on a long-running system may also produce ADRs for decisions visible in code — surface as a candidate, don't bury inside a node.

## References

Spec-driven-development consensus (2026): GitHub Spec Kit, AGENTS.md, Addy Osmani's "How to write a good spec for AI agents", AWS Kiro, Reversa, SpecFact code2spec, OpenSpec spec-gen, EARS notation, Karpathy's vibe-to-agentic, Aakash Gupta's PRDs Modern Guide, David Haberlah's PRDs for AI Coding Agents.
