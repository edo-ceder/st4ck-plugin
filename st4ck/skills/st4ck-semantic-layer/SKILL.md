---
name: st4ck-semantic-layer
description: Use when authoring or updating a st4ck project's MCP semantic-layer docs (under the project's docs/MCP — the business-language-to-data guide an LLM reads before answering questions about that project's live data). Trigger after any data-model change (new/renamed field, option set/enum, table, or workflow), or when a glossary/metric/gotcha needs adding or correcting. Works for any st4ck project on any data source (Bubble, Supabase, or code). Keeps the layer grounded in the real schema, not guessed, and stamps each data file `source: mcp_server` so the Claude connector's get_project_guide delivers it.
---

# Maintaining a st4ck Project's Semantic Layer

**Announce at start:** "I'm using the st4ck-semantic-layer skill to update the MCP docs."

A **semantic layer** lets an external LLM (a project admin's Claude or GPT) turn business
questions into correct queries against the project's live data over MCP. It lives in the
project's `docs/MCP/` folder and syncs into the st4ck project documentation section. Your job is
to keep it **true** and **minimal** for whichever st4ck project you're in.

## What the layer is — and is not

- It **is** a semantic layer: glossary (business term → field), canonical metric definitions,
  the domain's lifecycle/state model, and gotchas (fields that lie).
- It is **not** a PRD. Do not add product rationale, roadmap, or requirements. The reader (an
  LLM) needs *what the data means*, not *why the product exists*. If you feel the urge to
  explain intent, stop — that belongs in the PRD.

## Standard file map (create/keep this shape)

| File | Holds |
|------|-------|
| `00-README.md` | Purpose, how-to-use recipe, cardinal rules, file map. |
| `01-data-dictionary.md` | Entities/tables, fields, relationships, enum values. |
| `02-glossary.md` | Business term → entity/field. |
| `03-metrics.md` | One canonical definition per metric. |
| `04-lifecycle.md` | The domain's state machine (if the domain has one). |
| `05-gotchas.md` | Fields whose name contradicts their meaning. |

Adapt to the project: a project with no lifecycle can drop `04`; a large one can split a file.
Keep numbered prefixes for reading order.

## Stamp the marker — `source: mcp_server` (REQUIRED, or the connector can't see it)

The Claude Connector's `get_project_guide(project_id)` returns a project's guide by selecting the
PRD nodes whose `source_type = 'mcp_server'`. So **every data file above (`00-README` …
`05-gotchas`) MUST carry YAML frontmatter** marking it:

```md
---
source: mcp_server
---

# Data Dictionary
…
```

- Mark ONLY the semantic-layer **data files**. Do **not** mark a `Skill/` subfolder or any
  install / how-to-use docs — those are meta and must stay out of the guide (leave them with no
  frontmatter, or `source: import`).
- You do **not** hand-arrange folders or add `sort_order`: on sync, st4ck derives reading order
  from the `NN-` filename prefix and nests the whole `docs/MCP/` folder under one "MCP" node
  automatically. Just keep the `NN-name.md` names + the `source: mcp_server` marker.
- After authoring, the project owner runs the PRD GitHub sync (Settings → Integrations, or it
  runs on the next pull) and the guide is live for the connector. An **unmarked** file is
  invisible to `get_project_guide` — the marker is the single thing that wires it up.

## The three non-negotiable rules

1. **Data is truth — never invent a field, value, or filter.** Every claim must trace to the
   live schema, an enum/option-set export, or a verified code-walk. Tag uncertain items
   "*verify against live*" rather than stating a guess as fact.
2. **One definition per metric.** A metric defined in `03-metrics.md` must not be redefined
   elsewhere. Other files *link* to it; they never restate a different filter.
3. **Inline, don't defer — pre-resolve anything the consumer would otherwise look up.** In
   production you do **not** want the consumer LLM making extra round-trips to discover facts you
   could have written down once. So during authoring, **resolve and bake in** every lookup-able
   value: exact enum/option strings (harvest them from live records, not just by meaning), the
   precise field key the query layer expects, and any fixed IDs/constants. The maintenance cost
   (re-harvest on change) buys every future query a faster, more reliable answer with no
   exploratory calls. The only thing left for the consumer to resolve at runtime is genuinely
   live data (today's rows) — never schema facts.

   **Q&A that drove this (keep as guidance):** *"Should the LLM look up exact Hebrew status
   strings at query time, or should we bake them in?"* → **Bake them in.** "In real life I don't
   want the LLM going looking for anything it doesn't have to." Harvest exact values from live
   records during authoring and inline them; mark any value not yet seen in live data
   `(export)` / `verify-live` so the consumer knows the one case where a sample is still needed.

### How to harvest exact enum values (don't trust the schema API alone)

The schema/introspection API usually gives enum *names/meaning* but not the *exact stored
string* a query must match — and apps can return fields by **display caption** rather than
internal id (e.g. Bubble with `use_captions_for_get`). So:
- Pull a batch of live records for each option-bearing type (`bubble_list_records` /
  `supabase_query`), `grep` the distinct values per field, and inline those exact strings.
- Note the **query key** the API actually uses (caption vs field_id, and its exact casing) — if
  it differs from the schema's field id, document it as a gotcha and use it everywhere.
- For values that never appear in recent data, fall back to the export/enum definition and mark
  them so; don't drop them.

## Workflow for an update

1. **Identify the project's data source** — `get_data_connections` tells you what's connected
   (Bubble live/test, Supabase via OAuth/PAT). The introspection tool differs by source:
   - **Bubble:** `bubble_get_schema(environment)` for entities/fields. Enum (option-set)
     **values** are NOT in the schema API — read them from the Bubble export file in the repo
     (`*.bubble`, JSON, under `option_sets[name].values[*].{display, db_value}`). Non-Latin
     `db_value`s often equal their display string — document by meaning and tell the reader to
     sample a live record for the exact query string.
   - **Supabase:** `supabase_list_tables` + `supabase_describe_table`; enums from the column
     types / `supabase_query` against `pg_enum` or a sample row.
   - **Code-only:** read the source; the code is truth over comments and docs.
2. **Pre-sweep.** Grep the whole `docs/MCP/` tree for every mention of the field/value/term
   you're touching — the surface is usually bigger than one line (glossary + metric + gotcha +
   dictionary often all reference the same field).
3. **Fix**, applying the change across every site the pre-sweep found.
4. **Post-sweep.** Grep again for anything the fix made stale (an old field name in a metric, a
   renamed enum in the glossary, a count that drifted).
5. **Cross-file consistency check.** A field's dictionary entry, glossary row, metric, and any
   gotcha must agree. Per-file correctness does not imply cross-file consistency — audit the
   field across all four.

## When you discover a "field that lies"

Any field whose name contradicts its behaviour (an inverted boolean, an offset enum, a
dead/legacy field, a misleading allow/deny list) goes in `05-gotchas.md` immediately — with its
**evidence basis** tagged (`verified: live schema` / `verified: enum export` /
`verified: code-walk` vs `hypothesis: unverified`). These entries are the layer's highest value;
do not let one sit "until later".

## How the layer reaches the LLM (the Claude Connector)

The semantic layer is delivered through the **st4ck Claude Connector** — no per-project consumer
skill or hand-installed prompt needed. When a user connects st4ck to Claude and asks a data
question about the project, Claude calls `get_project_guide(project_id)`, which returns exactly
the `source: mcp_server`-marked files above (in `NN-` order), then queries the live data using the
terms/values you baked in. So the ONE thing that makes the layer usable is the marker — an
unmarked file is invisible to the connector.

## Done means

- Every data file carries `source: mcp_server` frontmatter (Skill/meta files do NOT).
- Every changed claim traces to live schema / export / code-walk.
- Pre- and post-sweeps run; no stale references remain.
- No metric is defined twice; no PRD-style intent crept in.
- New gotchas carry an evidence tag.
