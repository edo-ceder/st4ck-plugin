---
name: prd-from-source
description: Author a Product Requirements Document from an existing codebase, code export, or unpacked low-code project — by reading source rather than asking the user. Use when the user wants a PRD generated from imported elements, exported builders (Bubble, Webflow, Retool), screen recordings, or any "code-first" reverse-engineering of intent. Self-contained — bundles its foundational PRD-authoring rules so it works with or without a server connection.
---

# PRD From Source

**Announce at start:** "I'm using the prd-from-source skill — authoring a PRD by reading the codebase rather than asking the user."

A PRD authoring skill grounded in the **spec-driven development** consensus that emerged 2024–2026 (GitHub Spec Kit, AWS Kiro, Reversa, OpenSpec, AGENTS.md). PRDs authored with this skill are:
- Read-by-source, not asked-of-humans.
- Three-audience: non-technical stakeholders, QA engineers, developers.
- File-based, Markdown + YAML frontmatter, one node per file — durable in Git, importable into PRD databases.
- Machine-parseable with stable IDs and confidence markers.
- Verifiable: every claim attests its source.

## When to use

- The user wants a PRD for a system whose source already exists (running code, exported builder, unpacked low-code project).
- A test-authoring or QA effort needs an intent layer the codebase doesn't formally have.
- A migration / re-platforming requires capturing the as-built behavior before re-implementing.
- An agentic coding workflow needs a spec layer to anchor implementation, planning, and review.

**Do not use** when the user is *designing* a new feature from scratch — for that, use a requirements/discovery skill, not this one.

---

## Foundational rules (PRD authoring at a glance)

These rules apply to any PRD, source-grounded or otherwise. They are the substrate this skill operates against; everything below builds on them.

### The Rebuild Test

Every PRD node must pass this test: could a developer who has never seen this application implement exactly this feature from your description alone — with no access to source code, no product owner to ask, no designer to consult?

If they would need to guess anything, you haven't written enough. Every omitted detail is a question they cannot answer. Every vague description is a feature they will build wrong.

### Tree structure

The PRD is a hierarchy. Target depth is 4–5 levels:

```
root → module → screen / entity / user_flow / backend_flow / business_rule / integration
     → component / field / logic / validation / endpoint / error_state / element / button
```

- Create parent nodes before children.
- Keep parent node content to a 2–3 sentence overview. All detail goes in children.
- A node with rich detail MUST be decomposed — never write one long document at the parent.

### Decomposition rules

| Parent type | Required children |
|---|---|
| **Screen** | One `component` per distinct UI section (header, form, table, sidebar, modal). One `element` per interactive element with non-obvious behavior. |
| **Entity** | One `field` per non-trivial field (or small group of closely related fields) — type, constraints, defaults, validation. Skip boilerplate (id, created_at, updated_at, deleted_at). |
| **User flow** | One `logic` per major step (action, system response, decision point). One `error_state` per distinct failure path. |
| **Backend flow** | One `logic` per processing stage. One `validation` per input guard. One `endpoint` if the flow exposes an API. |
| **Business rule** | One `validation` per distinct condition. One `error_state` per exception. |
| **Integration** | One `endpoint` per call direction (inbound / outbound). |

### Node types (choose the most specific)

- **Structural:** `root`, `overview`, `module`, `subsystem`
- **Feature-level:** `screen`, `section`, `user_flow`, `backend_flow`, `entity`, `business_rule`, `integration`, `process`
- **Detail-level:** `component`, `element`, `field`, `button`, `logic`, `validation`, `error_state`, `endpoint`

### Cross-link types

`calls_endpoint`, `uses_entity`, `enforces_rule`, `triggers_flow`, `depends_on`, `related_to`, `validates_with`, `redirects_to`

Cross-link screens to entities they display, flows to rules they enforce, endpoints to their flows.

### Content quality

Write as a product document. Describe what the software does, not how it's built:
- ❌ "The `useAdvisor()` hook checks `isAdvisor === true` and renders `AdvisorBanner`"
- ✅ "When a financial advisor logs in, the system displays a banner indicating they are viewing a client's data"

Rules:
- No function names, variable names, component names, class names, or file paths in the body.
- Name UI fields as the user sees them (the label in the UI, not the DB column).
- Describe validation rules in plain language.
- Quote error messages exactly as the user reads them.
- Be specific — vague statements fail the Rebuild Test.

### Verification against source code

A PRD is only as accurate as the code it describes:

1. **Read the actual code** — never document features based on README files, code comments, or docstrings alone. Comments lie, code doesn't.
2. **Verify connectivity** — a backend service that exists but is not wired to any active route or frontend component is currently unused. Document as deprecated/legacy, not as active.
3. **Trace end-to-end** — for each feature, confirm the chain (UI element → API call → handler → service logic → database). If any link is broken, the feature is not active.
4. **Prune unused features** — disconnected services go under "Deprecated & Legacy", not the active modules.
5. **Verify numbers** — when stating counts (tables, routes, endpoints), actually count them. Don't copy stale numbers from existing docs.

### Final self-review checklist

Before considering a PRD complete:

- [ ] Every module node has children (not just one markdown blob).
- [ ] Tree depth reaches 3–5 levels.
- [ ] No features described that are disconnected from the live application.
- [ ] All counts and statistics verified against the actual codebase.
- [ ] A developer reading any leaf node could implement that piece without guessing (Rebuild Test).

---

## Phase 0 — Preliminaries (MANDATORY before walking any source)

**A PRD without an anchor produces garbled assumptions from raw code reading.** Run these four checks before opening the first source file. They take 5 minutes total and save hours of misinterpretation downstream.

### 0.1 Check for user-role taxonomy in st4ck

If the project is connected to st4ck (i.e., the orchestrator has access to `mcp__st4ck-pm__*` or `mcp__st4ck-dev__*` tools and the project has a briefing):

```
get_project_users()      # lists project_users / user types with roles, permissions, descriptions
get_project_briefing()   # one-liner about the app + recent versions
```

If `get_project_users` returns a non-empty taxonomy, **use that as the role anchor for the whole PRD**. Every `user_role_ids:` slug, every state-machine role binding, every privacy rule cites these roles by name. Don't reinvent role IDs from the code's option-set values; reconcile both.

If `get_project_users` returns empty OR no st4ck connection exists, proceed to 0.2.

### 0.2 — Ask the **app context** (5 questions, ~60 seconds to answer)

Before role taxonomy, get the higher-frame answer: **what kind of app is this, who is it for, how does it differ from a generic SaaS?** These five questions decide the rigor target for the whole PRD — what to test exhaustively vs. what to leave informal.

1. **Purpose** — what does the system do, in one sentence? (e.g., "scheduling platform for clinic appointments" / "B2B procurement tool" / "internal incident-response console".)
2. **Type** — what kind of app? *Business-specific (private/internal)* / *vertical SaaS (one industry, many tenants)* / *horizontal SaaS (many use cases, public sign-up)* / *internal tools* / *consumer app*.
3. **Audience** — who's it for? Concrete numbers: a few employees of one company? A known set of partner companies? Open public sign-up? (e.g., "~10 operator staff + ~50 supplier partners + ~200 buyer companies".)
4. **Deployment model** — single-tenant private install / multi-tenant SaaS / hybrid?
5. **Language posture** — single-language with no localization plans / multi-language with formal translation / single now but translation expected later?

**Why these five matter:**

| Answer pattern | What the PRD can skip or downplay |
|---|---|
| Business-specific + single tenant + single language | i18n testing, translation completeness, SLA documentation for users, public-sign-up flows, multi-tenant security tests as "attacker defense" (still test isolation — but accepted-as-design rather than treated-as-threat). Edge cases that "would never happen with these specific users" can be marked accepted. |
| SaaS + multi-tenant + multi-language | All of the above MATTER. Cross-tenant isolation is defense-against-strangers. Translation completeness gates release. Edge cases are paying customers. |

For business-specific apps, **edge-case findings that "wouldn't happen with these specific users" are legitimately closeable as accepted operational behavior** — the user-base is known and self-correcting. For SaaS, the same finding is a real bug.

### 0.3 — Ask the role taxonomy and primary lifecycle

After 0.2's context, ask:

6. **The full role list.** Every user type with its own access surface — name, one-line purpose, scope (tenant vs cross-tenant), and (if business-specific) approximate headcount.
7. **The primary workflow or lifecycle.** What's the recurring journey the app exists to support? ("Four-phase trading day: initiate → open shop → close shop → close arrangement.")
8. **Key entities (nouns).** The data the app revolves around.
9. **Tech stack / source shape.** Live codebase? Exported builder (Bubble/Webflow/Retool)? Screen recordings? This determines what file shapes the orchestrator will read.

### 0.4 — Ask about other documentation to include

Existing artifacts are usually richer than the code:

- Old PRDs, design docs, wireframes, system diagrams.
- Slack threads or meeting notes that captured decisions.
- Customer-facing help pages (often the most accurate behavior description).
- Existing spec/ADR documents.

Ask the user explicitly: *"Do you have any other documentation you'd like to use as input for this PRD pass?"* Be specific about the categories above — users often forget they have these.

When the user provides extra docs, treat them as **hints, not source of truth** (code still wins per Iron Rule #1). But hints from a real PRD or help page often answer questions that are ambiguous in raw code.

### Ask all questions in ONE message

Don't ping the user nine times. Send all of 0.2 + 0.3 + 0.4 in a single message — it's a 60-second answer for them, and the orchestrator's whole rigor framing comes from these. **The single biggest Phase 0 anti-pattern is making the user feel like a long discussion is starting.** It isn't — it's a quick anchor.

### Phase 0 output

A short anchor block written to the PRD root `_index.md` BEFORE any modules are authored:

- App in one sentence + type + audience + deployment + language posture.
- The role taxonomy (from st4ck or from the user).
- The primary lifecycle.
- The key-entity list.
- The source shape.
- A list of additional input documents (with file paths or links).
- **A "PRD rigor frame" note**: what gets tested rigorously, what gets accepted as operational/informal, what's out of scope. Derived from the answers to 0.2.

Pass 1 (mechanical scaffold) and Pass 2 (curated intent) follow. Without Phase 0, both passes are guessing.

## The four iron rules

### 1. Code is the spec.

A product question the running code answers is not a question — it is a fact waiting to be read. The default move for an apparent clarification is to investigate, in this order:

1. Read the source file you cited.
2. Read the sidecar metadata (`.meta.json`, AST dump, raw export blob) for operators or attributes the human-readable summary may have stripped (list operators like `add`/`remove`, condition values that reference internal codes, etc.).
3. Query live data via available MCP tools (`*_get_schema`, `*_describe_table`, `*_query`).
4. **Only then** draft a `[NEEDS CLARIFICATION]` — and only for genuinely-unanswerable-from-code things (untranslated copy, design intent for an empty state, business decisions on un-built features).

#### Corollary — call out unused / aspirational / dead code without hedging.

When the source shows that something is never called, never set, never reached, **state it plainly**. Don't soften "this is dead code" to "this might be unused" or "this needs verification". The grep result is the verification. A confident finding can be reviewed and corrected by the orchestrator or user; a hedged finding cannot be acted on.

Specific phrasings that belong in the PRD when the code supports them:

| What you found | How to write it |
|---|---|
| Field exists in schema but no code reads it | "**Dead field.** Not read by any workflow or screen condition. Treat as historical; do not write new logic against it." |
| Workflow exists but no caller invokes it | "**Orphan workflow.** No caller found in pages, reusables, or other workflows. Either vestigial or invoked externally; tests should NOT assume it runs." |
| Status value exists in option set but no workflow assigns it | "**Unreachable status.** The option set defines this value but no code path assigns it. Aspirational placeholder OR dead label." |
| Role / permission branch exists in routing but goes nowhere | "**Dead route.** A user reaching this branch is stranded. Either intentional (the role has no UI) or a regression — confirm with stakeholder." |
| Permission split between two roles is absent in code | "**No separation.** Roles X and Y have identical permissions on this surface, by design or by oversight. Tests must not assert one can do something the other cannot." |

A PRD that hedges every dead-code finding to "needs verification" is useless to the orchestrator and the user — the next session will redo the same investigation. A PRD that states findings plainly creates a record the user can review and either confirm or correct.

**The orchestrator's review pass on its own findings is always available.** A confident-but-wrong finding is reviewable. A hedged finding is permanently ambiguous. Prefer the former.

### 2. Cite your sources — always.

Three confidence markers, inspired by [Reversa](https://github.com/sandeco/reversa):

- **`[CONFIRMED: <src>]`** — claim is directly observable in the cited source. Default for everything you write.
- **`[INFERRED: <src>]`** — claim is a reasonable read of the source but involves judgment (e.g., interpreting an option-set's intended meaning from its usage in workflows when the option set itself is opaque).
- **`[GAP]`** — the source is silent or ambiguous on this point. Used sparingly and always with a concrete question for the next pass.

Source paths go in the file's frontmatter `source:` list. Inline citations within prose are allowed as footnote-style `[src: <path>]` when a specific claim warrants it.

### 3. Memory is a hint, not a source.

If your environment has persistent memory (prior conversation notes, auto-memory records, project briefings):

- Treat memory as a **hint about where to look**, not as ground truth.
- Verify every claim against the current code before citing it in the PRD.
- Memory may be from failed prior attempts — particularly for PRDs of long-lived systems where someone may have tried (and abandoned) this work before.
- If a memory record names a specific identifier (function, table, status), confirm it still exists in code before relying on it.

### 4. Subagent reports must be attested.

When dispatching a subagent (Explore, Plan, research) to read code:

- **Require the agent to cite specific file paths (and ideally line numbers) for every non-trivial claim it makes.**
- A subagent that returns "the page has 11 tabs" without citing which files declare those 11 tabs is producing un-auditable claims — treat as a hint, not a fact.
- **Spot-check at least one claim per subagent return** before relying on the rest. Pick a specific assertion, verify it against the source. If it holds, the rest is probably OK; if it doesn't, demand attestation for everything.

A good subagent dispatch prompt always includes:
> For each claim you make, cite the specific file path under the source root where you read it. If you cannot cite a file for a claim, mark the claim as `[INFERRED]` or `[GAP]`. Do not blend confirmed and inferred claims as if they were the same.

This is the single biggest mitigation against subagent hallucinations.

## Two-pass approach

### Pass 1 — mechanical scaffold

Walk the source and create one PRD node per first-class artifact, with a 2–3 sentence overview each:
- One entity per data type / schema table.
- One screen per page / route.
- One backend flow per server-side workflow / function / handler.
- One option-set / enum captured as a referenced concept.

Fast, complete, produces a flat re-encoding of structure. **Low test signal on its own** — but it gives you the skeleton.

### Pass 2 — curated intent

Walk the same artifacts again and add the layer the source does not encode:
- User flows that traverse multiple screens / handlers.
- Business rules extracted from condition expressions, status state machines, privacy/auth gates.
- Cross-links between screens ↔ entities, flows ↔ rules, rules ↔ entities.
- Role bindings (`user_role_ids`) on every node where role matters.

Pass 2 is where the PRD becomes useful for test authoring.

## File-based authoring shape

Author as Markdown under `<project>/<path>/docs/prd/` (project-conventional location). One MD file per node. A future importer can walk the tree and call DB writes.

### Folder layout

```
docs/prd/
├── _index.md                              # root
├── 00_shared/                              # cross-module reusables + shared concepts
│   ├── _index.md
│   ├── components/                         # menus, sidebars, popups
│   ├── state_machines/                     # status option sets, lifecycle flags
│   ├── integrations/                       # external services
│   └── entities/                           # entities referenced from multiple modules
├── 01_<module>/
│   ├── _index.md
│   ├── entities/<entity>/_index.md         # entity head
│   │   └── <field>.md                      # field children where business-meaningful
│   ├── screens/<screen>/_index.md
│   │   └── <component>.md                  # component children
│   ├── user_flows/<flow>.md
│   ├── backend_flows/<flow>.md
│   └── business_rules/<rule>.md
```

**Rule:** a folder represents a parent node; its `_index.md` is the overview; sibling files (or sub-folders) are the children. Decomposed nodes get a folder; leaf nodes are a single `.md`.

### Cross-module reuse rule

When the user says "build a PRD module-by-module", choose ONE of the following per shared artifact:

| Artifact type | Treatment | Example |
|---|---|---|
| **Physical reusables** (same component rendered in multiple modules) | Author ONCE in `00_shared/`, cross-link from each module that uses it | A site header used by both the Admin Home and the Member Home |
| **Concepts that cross modules** (a flow whose narrative differs by perspective) | DUPLICATE in each module, with cross-links to the other modules' perspectives | A multi-party transaction described from the Buyer's view, the Seller's view, and the Operator's view |

A PRD is intent by audience, not an architectural blueprint. The "duplicate with cross-link" pattern preserves each audience's narrative while keeping consistency via the links.

### Frontmatter schema

Every PRD MD file starts with YAML frontmatter:

```yaml
---
node_type: <root|module|screen|entity|field|user_flow|backend_flow|business_rule|component|element|integration|...>
title: <human-readable title>
summary: <one line — used as the overview when this node is referenced from a parent>
user_role_ids: [admin, editor]            # slugs from the project's role taxonomy; optional
source:                                    # provenance — paths into the original codebase/export
  - "data_types/some_entity/"
  - "backend_workflows/update_x/"
cross_links:                               # links to other PRD nodes (paths relative to docs/prd/)
  - target: 01_module/entities/some_entity
    type: enforces_rule
delta: ADDED                               # optional, for brownfield diff passes (ADDED/MODIFIED/REMOVED/UNCHANGED)
---
```

### Content rules

- **Body is product language.** No function names, variable names, file paths, DB column names, or component class names in the body. Source paths live in frontmatter `source:`.
- **Use the labels the user sees** in the app's primary language. For localized apps, include an English gloss alongside (RTL or LTR — doesn't matter). Internal `db_value` strings are correct *nowhere*.
- **2–3 sentence overview** on parent nodes; detail lives in children. If a parent grows past ~200 words, decompose.
- **Quote error messages exactly** as a user reads them.
- **Be specific.** Vague statements fail the **Stranger-Implementer Test** (defined below).
- **Every leaf gets a "Test implications" section.** Not optional. The PRD's three audiences include QA — leaves without test implications are missing one of their primary purposes.

### Stable IDs (recommended)

Each `user_flow` and `business_rule` should carry a stable ID in frontmatter — pattern `FLOW-<MODULE>-<NN>` or `RULE-<MODULE>-<NN>`. Test cases can then cite these IDs cleanly. (Optional but valuable; adopt early if downstream test tooling expects it.)

## Audience triple-target

Every node should be readable by all three audiences:

| Audience | What they need | How the node delivers |
|---|---|---|
| Non-technical stakeholder | What the system does, in plain English / native UI language | Body prose; UI labels with translation glosses; behavior described in observable terms |
| QA engineer | Test preconditions, success states, error paths, what to assert | "Test implications" section on every leaf; state machines with explicit transitions and side effects |
| Developer | Source provenance for ground-truth verification; decomposition deep enough to anchor tests on specific UI surfaces | `source:` frontmatter; tree depth 3–5 levels; cross-links for traceability |

## Stranger-Implementer Test

The completeness check for any leaf node: **could a stranger (no access to source code, no product owner to ask, no designer to consult) implement exactly this piece from this node alone?** If they'd need to guess anything, the node is incomplete.

Industry equivalent terms: "Rebuild Test" (the older internal phrasing), "completeness check" (Spec Kit), "self-sufficiency test".

## Working with exported / unpacked codebases

Many low-code exports follow a similar shape: a `.md` body for humans + a `.meta.json` (or similar) sidecar for the raw builder data. **Always check both.** Some critical facts live only in the sidecar:

- List operators (`add` / `remove` / `set`) are often in JSON but stripped from MD bodies.
- Conditional expressions may be summarized in MD but the binding to specific roles / option-set values is only resolvable via the JSON.
- Identifiers (option `db_value`, internal IDs) may be obfuscated in MD but readable in JSON.

**When a sidecar exists, treat the MD as "the index" and the JSON as "the truth".** If the two disagree, the JSON wins.

### Common export quirks

| Symptom | What's actually going on | What to do |
|---|---|---|
| Schema-extraction document has fewer entities than the source folder | Extraction was a partial pass; don't trust counts | Walk the source folders directly |
| Option-set `db_value` shown as `____` / `_____` / etc. | Builder obfuscated the value during export | **Don't decode it.** The PRD describes user-observable behavior, not DB values. If a workflow sets a status to "the underscore value that displays as 'Sent to processor' in the user's locale", document it as "the workflow sets status to Sent" — the display label is what matters. See the **Internal-code anti-pattern** below. |
| MD says "Field Changes: list-field = value" | List operator (add/remove/set) is in the JSON | Read `.meta.json` for the `action` key. List operators DO matter for behavior. |
| Workflow with `Ignores Privacy: yes` | System-level actor, runs without user role context | Document the privacy bypass explicitly in the PRD |
| Reusable element appears under multiple names in different file lists | The export wraps each reusable instance with a wrapper element that has its own display name | Verify which actual reusable is mounted by reading the instance file's `Reusable Element:` line |

### The internal-code anti-pattern

A PRD describes **what the user does** and **what observably changes**. It does NOT describe the database, the field key, the option-set `db_value`, the workflow's internal name, or any other engineering identifier. These rules apply even when the orchestrator can resolve them:

| Tempted to write | What the PRD should say instead |
|---|---|
| "sets `status_option_order_status` to `option:order_status:____________`" | "sets the order status to **Submitted**" |
| "the search filters by `type_option_user_types equals option:user_types:____0`" | "the search filters for Customer-type companies" |
| "fires when `is_temp_record_boolean equals false`" | "fires for real (non-temporary) records" |
| "calls `change_pass_text` via Bubble's UpdateCredentials action" | "updates the user's stored password" |

The temptation to spend effort decoding `____` strings or naming internal operators is wasted effort — the PRD's reader (PO, QA, dev) cares about observable behavior. If a finding cannot be expressed without leaking a code value, the finding hasn't been understood yet.

The **only places engineering identifiers are valid** in this skill's output:
- The `source:` frontmatter list — provenance citations.
- The Test implications section, IF naming a specific assertion target requires the identifier (e.g., "verify the order's `Status` field reads as Submitted in the UI"; the field name appears once, as an anchor, not as repeated jargon).
- Footnote-style `[src: path]` citations on disputed claims.

Writing for the PRD's audience means writing about the product, not the platform's internals.

## AGENTS.md companion file — operational only

Per the [AGENTS.md convention](https://agents.md/) now stewarded by the Linux Foundation, a project that has a PRD should also have a project-root `AGENTS.md`. But **AGENTS.md and the PRD have non-overlapping purposes**, and confusing them creates drift hazards:

| Belongs in AGENTS.md | Belongs in the PRD |
|---|---|
| Where files live in the repo | What the product does |
| Build / test / run commands | Entities, flows, business rules |
| Code conventions, naming, style | State machines |
| Always / Ask first / Never operational tiers | Security findings, dead code, known issues |
| Which MCP tools / skills are wired up | Stakeholder questions |
| A pointer to the PRD root | Cross-tenant isolation rules |

**Rule:** if a piece of content describes the *running product*, it belongs in the PRD — not AGENTS.md. If a piece of content describes *how to work in this repo as an agent*, it belongs in AGENTS.md.

The reason this matters: AGENTS.md has no update mechanism tied to product changes. If a workflow's behavior changes, the PRD update is part of the change; AGENTS.md sits next to the repo root and tends to rot. **The fix is to never let AGENTS.md own product knowledge in the first place.** Make it small, operational, and have it link to the PRD for everything else.

The PRD-from-source pass is a natural moment to emit or refresh AGENTS.md, BUT:

- The AGENTS.md content should be **only** the operational/structural facts about the repo, NOT a recap of the PRD's product context.
- The PRD's `_index.md` and `KNOWN_GAPS.md` are the agent's destination for product knowledge — AGENTS.md just points there.
- If you find yourself copying a paragraph from the PRD into AGENTS.md, stop. Link to it instead.

A good AGENTS.md after a PRD-from-source pass is ~50–100 lines. If it's longer, it's probably bleeding PRD content into a file that doesn't have an update mechanism.

## Using live-data MCP tools (when available)

If the project exposes MCP tools that read the running database / API:
- `*_get_schema`, `*_list_records`, `*_describe_table`, `*_query` — preferred over re-deriving schema from an export.
- Use them to resolve any export ambiguity (obfuscated values, "is this field still used", row counts).

This rule exists because **export → PRD is a translation**, and translations drop information. Live data is the closest thing to the source of truth.

## Cross-link types

From the upstream methodology: `calls_endpoint`, `uses_entity`, `enforces_rule`, `triggers_flow`, `depends_on`, `related_to`, `validates_with`, `redirects_to`.

Cross-link screens to entities they display, flows to rules they enforce, entities to the rules that gate them.

## Decomposition rules (condensed from upstream methodology)

| Parent | Required children |
|---|---|
| **Screen** | One `component` per UI section; one `element` per non-obvious interactive element. |
| **Entity** | One `field` per business-meaningful field (skip boilerplate id/timestamps). |
| **User flow** | One `logic` per major step; one `error_state` per failure path. Or capture in body sections with clear step numbering for shorter flows. |
| **Backend flow** | One `logic` per processing stage; one `validation` per guard; one `endpoint` if it exposes an API. Or describe in body when ≤ 10 actions. |
| **Business rule** | One `validation` per condition; one `error_state` per exception. Or compact in body for simple rules. |
| **Integration** | One `endpoint` per call direction (inbound / outbound). |

## Self-review checklist

Before declaring a module complete:

- [ ] Every parent node has children (not just a single MD blob at the top).
- [ ] Tree depth reaches 3–5 levels, not just root → module (flat).
- [ ] No `[NEEDS CLARIFICATION]` for things the code answers.
- [ ] All counts and statistics verified against the actual codebase (every quoted number was actually counted).
- [ ] No function names, file paths, or DB column names leaked into MD bodies.
- [ ] Cross-links resolve to real PRD nodes (not dangling).
- [ ] Every node's `source:` paths point at files that exist.
- [ ] Every leaf node has a "Test implications" section.
- [ ] A stranger reading any leaf node could implement that specific piece without guessing.
- [ ] At least one claim per subagent report has been spot-checked against the source.

## Anti-patterns (learned the hard way)

- ❌ **"This needs business sign-off" for code-discoverable behavior.** If the system has been running for a year, the behavior is the decision.
- ❌ **Citing memory or prior docs as fact.** Memory may be wrong, summarized, or from a failed prior pass.
- ❌ **Trusting schema-extraction artifacts as a complete entity list.** They may be partial.
- ❌ **Describing UI mechanics from intuition.** Easy to assume "inline grid" when the code does "list-of-rows-with-popup-editing". Read the elements.
- ❌ **Trusting subagent reports without spot-checking.** They hallucinate. Spot-check.
- ❌ **Writing 100 PRD nodes at once without checkpoint.** Stage by module, get sign-off, then continue.
- ❌ **Designing for "the importer" before any importer exists.** Author for human readability and Git diffs first; structure is the importer's job.
- ❌ **Decoding obfuscated internal identifiers when the user-facing label is right there.** A PRD says "status moves to Submitted" — not "status moves to the option whose `db_value` is `____________`". Spending effort to disambiguate underscore-count strings is wasted work; the display label is what the PRD cares about. (See "The internal-code anti-pattern" above.)

## Working order

1. **Phase 0 — Preliminaries** (mandatory). Check `get_project_users` if connected; otherwise ask the user for the role taxonomy + app anchor. Ask about other documentation. Write the anchor block to the PRD root.
2. Re-read the **Foundational rules** section above so taxonomy, decomposition rules, and the Rebuild Test are loaded.
3. Walk the source root, list modules. Identify which artifacts are physically shared (these go in `00_shared/`).
4. Pick one module. Mechanical scaffold (Pass 1) + curated intent (Pass 2). Stop.
5. User reviews module N. Adjust shape. Then proceed to module N+1.
6. After all modules: hand off to `prd-review` skill for the four-phase review pipeline.
7. Emit / update the project-root `AGENTS.md` — operational steering only (see the AGENTS.md section).
8. Resist the urge to refactor the format mid-build. Lock the shape on module 1.

## Distinction from PRD / Spec / ADR / Plan

In the spec-driven-development consensus, four artifacts have distinct purposes — this skill produces the first:

- **PRD** (this skill): captures *intent + behavior*. What does the system do, for whom, why.
- **Spec / tech-spec**: precise contract for *how* something is built. Derived from a PRD requirement.
- **ADR** (Architecture Decision Record): captures *why we chose this approach*. Standalone, cross-cutting.
- **Plan / Tasks**: *sequenced steps* to implement. Derived from a spec.

A PRD-from-source pass on a long-running system may also produce ADRs for decisions visible in code (e.g., "the platform deliberately runs the out-of-stock recompute on every line edit rather than batched at close — see ADR-001"). When you find a decision worth promoting to an ADR, surface it as a candidate, don't bury it inside a node.

## References

This skill is grounded in the spec-driven-development consensus as of 2026. Influential sources:

- [GitHub Spec Kit](https://github.com/github/spec-kit) — `/specify → /plan → /tasks → /implement` pipeline; `[NEEDS CLARIFICATION]` convention.
- [AGENTS.md](https://agents.md/) — universal project-level steering file.
- [Addy Osmani — "How to write a good spec for AI agents"](https://addyosmani.com/blog/good-spec/) — six-areas framework + Always/Ask first/Never tiers.
- [AWS Kiro](https://kiro.dev/docs/specs/) — three-file canonical structure (requirements / design / tasks).
- [Reversa](https://github.com/sandeco/reversa) — reverse-engineering with CONFIRMED/INFERRED/GAP confidence markers.
- [SpecFact code2spec](https://specfact.dev/blog/code2spec-technical-deepdive/) — AST-first reverse engineering.
- [OpenSpec spec-gen proposal](https://github.com/Fission-AI/OpenSpec/discussions/634) — brownfield delta markers (ADDED/MODIFIED/REMOVED).
- [EARS notation](https://alistairmavin.com/ears/) — structured English requirements; resurgent because LLMs parse it reliably.
- [Karpathy / vibe-to-agentic](https://aintelligencehub.com/articles/karpathy-vibe-coding-to-agent-workflows-may-2026) — the framing that motivates the shift.
- [Aakash Gupta — PRDs: A Modern Guide](https://news.aakashg.com/p/product-requirements-documents-prds) — bridge between classic (Cagan) and agentic-era PRDs.
- [David Haberlah — PRDs for AI Coding Agents](https://medium.com/@haberlah/how-to-write-prds-for-ai-coding-agents-d60d72efb797) — "DO NOT CHANGE" protection sections, non-goals as scope firewall.

