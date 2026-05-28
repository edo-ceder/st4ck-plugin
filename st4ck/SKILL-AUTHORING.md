# Skill-Authoring Style Guide

Codifies how `st4ck-plugin/st4ck/skills/**` and `st4ck-plugin/st4ck/agents/**` get written and re-edited. Authoritative for any future leanness pass. Cite this file when rejecting padded PRs.

Anchored in Anthropic's [Agent Skills — Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

## Size ceilings (non-negotiable)

| File type | Hard ceiling | Soft target |
|---|---|---|
| `SKILL.md` | ≤ 500 lines (Anthropic policy) | ≤ 250 lines (this repo's house rule) |
| `agents/*.md` (subagent system prompts) | ≤ 10 KB heaviest, ≤ 7 KB typical, ≤ 6 KB leaf | leaf agents fit in 4-6 KB |
| Forwarding-stub `SKILL.md` | ≤ 25 lines | — |
| Sibling `EXAMPLES.md` / `REFERENCE.md` | no ceiling — that's the point of progressive disclosure | — |

The 500-line ceiling is Anthropic policy. The 250-line house rule exists because **`get_qa_methodology` is not a skill** — agents pay full context cost on every SKILL.md load. Every token competes with conversation history.

## Core principle — Claude is smart

> *"Only add context Claude doesn't already have. Challenge each piece of information: 'Does Claude really need this explanation?' 'Can I assume Claude knows this?' 'Does this paragraph justify its token cost?'"* — Anthropic

Things Claude already knows: how to read code, how to call a tool, how a Markdown list works, what "idempotent" means, how `git diff` works. Things Claude does NOT know: load-bearing project rules, non-obvious tool side effects, gotcha patterns that have already broken something. Write the second set; cut the first.

## Shouts vs padding

Anthropic explicitly endorses imperatives: *"using stronger language like 'MUST filter' instead of 'always filter'"*. The shouts are not the problem; the words around them are.

**Keep every CRITICAL / MUST / NEVER / ⛔ / 🚨 / MANDATORY / DO NOT / YOU MUST.** They are load-bearing — they survive compaction better than soft prose because they read as policy.

**Cut around them:**
- Explanatory paragraphs that re-state the shout in softer words.
- "The reason for this rule is…" prose — if the rule needs a reason, put one short clause inline.
- "For example…" walks ≥ 3 paragraphs — collapse to one line or move to `EXAMPLES.md`.
- Tables that exist purely for visual organization where 3 bullets would do.
- Preamble that re-establishes context the surrounding skill already gave.

**Anti-pattern:** softening the shout instead of cutting the padding. `"You should usually avoid X"` is worse than `"NEVER X. <one-line why>."`.

## Progressive disclosure

When a SKILL.md grows past 250 lines, split into sibling reference files. Anthropic pattern:

```
skills/<name>/
  SKILL.md         # 100-250 lines: rules, workflow, hard limits
  EXAMPLES.md      # full worked examples (loaded only when needed)
  REFERENCE.md     # full enum list, full schema, full flag matrix
```

The skill description triggers SKILL.md. SKILL.md links the side files. Agent loads side files only when it actually needs them. This is the official Anthropic-recommended way to get past 250 lines without inflating the always-loaded surface.

Do NOT use progressive disclosure as an excuse to keep more total content. The default move when content is too long is **cut**, not **split**. Split only when every remaining sentence justifies its token cost AND the file is still over budget.

## When to split into a reference file

- The full enum / flag matrix only matters when the agent is actively using that surface.
- A worked example that takes ≥ 30 lines but a one-line summary captures the rule.
- Historical context (commit X did Y, was retired on date Z) that future readers need to look up but current authors don't need to re-read.

**Do not split:** the workflow steps themselves, hard rules, refusal triggers, tool-call ordering. Those must be in SKILL.md so they load on activation.

## Frontmatter discipline

The `description:` field is what triggers the skill. **Do not change it during a leanness pass** — that breaks activation. If a skill's name needs to change, that's a separate consolidation effort with its own forwarding-stub plan.

Frontmatter fields actually used by the harness: `name`, `description`. Anything else (custom `tags`, `version`, `sunset_after`) is metadata-only — fine to add but the harness does not act on it.

## Don'ts

- Don't add "## Overview" sections that paraphrase the description.
- Don't re-cite the same rule in 3 places in one skill — pick one location and let the others reference it.
- Don't duplicate methodology that's already on the server (e.g. block_format, component_authoring). Link to `get_qa_methodology(section: ...)` instead.
- Don't add changelog entries to SKILL.md bodies — that's commit-log territory.
- Don't paste full JSON schemas inline when the tool's own description carries them. Direct the agent to the tool description.

## Authoring loop

1. Draft against the size ceiling.
2. Run `wc -l SKILL.md` / `wc -c agent.md`.
3. If over: list every paragraph; ask "does this justify its token cost?" Cut anything that doesn't.
4. Preserve every CRITICAL / MUST / NEVER verbatim.
5. If still over: split a `EXAMPLES.md` / `REFERENCE.md` sibling.
6. Smoke test: spawn the skill on a representative task; confirm it still triggers and still refuses the things it's supposed to refuse.
