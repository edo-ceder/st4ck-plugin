# PRD From Source — Examples & Reference

Companion to `SKILL.md`. Loaded only when actively authoring against an export or hitting a dead-code finding. SKILL.md keeps the rules; this file keeps the worked patterns.

## Dead-code phrasing table

When the source supports a "this is dead" finding, write the finding plainly. These are the canonical phrasings:

| What you found | How to write it |
|---|---|
| Field exists in schema but no code reads it | "**Dead field.** Not read by any workflow or screen condition. Treat as historical; do not write new logic against it." |
| Workflow exists but no caller invokes it | "**Orphan workflow.** No caller found in pages, reusables, or other workflows. Either vestigial or invoked externally; tests should NOT assume it runs." |
| Status value exists in option set but no workflow assigns it | "**Unreachable status.** The option set defines this value but no code path assigns it. Aspirational placeholder OR dead label." |
| Role / permission branch exists in routing but goes nowhere | "**Dead route.** A user reaching this branch is stranded. Either intentional (the role has no UI) or a regression — confirm with stakeholder." |
| Permission split between two roles is absent in code | "**No separation.** Roles X and Y have identical permissions on this surface, by design or by oversight. Tests must not assert one can do something the other cannot." |

A PRD that hedges every dead-code finding to "needs verification" is useless to the orchestrator and the user — the next session will redo the same investigation. A PRD that states findings plainly creates a record the user can review and either confirm or correct.

**The orchestrator's review pass on its own findings is always available.** A confident-but-wrong finding is reviewable. A hedged finding is permanently ambiguous. Prefer the former.

## File-based authoring shape

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

When the user says "build a PRD module-by-module", choose ONE per shared artifact:

| Artifact type | Treatment | Example |
|---|---|---|
| **Physical reusables** (same component rendered in multiple modules) | Author ONCE in `00_shared/`, cross-link from each module | A site header used by both the Admin Home and the Member Home |
| **Concepts that cross modules** (a flow whose narrative differs by perspective) | DUPLICATE in each module with cross-links to the other modules' perspectives | A multi-party transaction described from the Buyer's, Seller's, and Operator's views |

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
- **Use the labels the user sees** in the app's primary language. For localized apps, include an English gloss alongside. Internal `db_value` strings are correct *nowhere*.
- **2–3 sentence overview** on parent nodes; detail lives in children. Parent grows past ~200 words → decompose.
- **Quote error messages exactly** as a user reads them.
- **Be specific.** Vague statements fail the **Stranger-Implementer Test**.
- **Every leaf gets a "Test implications" section.** Not optional. PRD's three audiences include QA — leaves without test implications are missing one of their primary purposes.

### Stable IDs (recommended)

Each `user_flow` and `business_rule` should carry a stable ID in frontmatter — pattern `FLOW-<MODULE>-<NN>` or `RULE-<MODULE>-<NN>`. Test cases can then cite these IDs cleanly. Optional but valuable; adopt early if downstream test tooling expects it.

## Export quirks

| Symptom | What's actually going on | What to do |
|---|---|---|
| Schema-extraction document has fewer entities than the source folder | Extraction was a partial pass; don't trust counts | Walk the source folders directly |
| Option-set `db_value` shown as `____` / `_____` / etc. | Builder obfuscated the value during export | **Don't decode it.** The PRD describes user-observable behavior, not DB values. If a workflow sets a status to "the underscore value that displays as 'Sent to processor' in the user's locale", document it as "the workflow sets status to Sent" — the display label is what matters. See the **Internal-code anti-pattern** below. |
| MD says "Field Changes: list-field = value" | List operator (add/remove/set) is in the JSON | Read `.meta.json` for the `action` key. List operators DO matter for behavior. |
| Workflow with `Ignores Privacy: yes` | System-level actor, runs without user role context | Document the privacy bypass explicitly in the PRD |
| Reusable element appears under multiple names in different file lists | The export wraps each reusable instance with a wrapper element that has its own display name | Verify which actual reusable is mounted by reading the instance file's `Reusable Element:` line |

## Internal-code anti-pattern

A PRD describes **what the user does** and **what observably changes**. It does NOT describe the database, the field key, the option-set `db_value`, the workflow's internal name, or any other engineering identifier — even when the orchestrator can resolve them:

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

## Decomposition rules (condensed)

| Parent | Required children |
|---|---|
| **Screen** | One `component` per UI section; one `element` per non-obvious interactive element. |
| **Entity** | One `field` per business-meaningful field (skip boilerplate id/timestamps). |
| **User flow** | One `logic` per major step; one `error_state` per failure path. Or capture in body sections with clear step numbering for shorter flows. |
| **Backend flow** | One `logic` per processing stage; one `validation` per guard; one `endpoint` if it exposes an API. Or describe in body when ≤ 10 actions. |
| **Business rule** | One `validation` per condition; one `error_state` per exception. Or compact in body for simple rules. |
| **Integration** | One `endpoint` per call direction (inbound / outbound). |
