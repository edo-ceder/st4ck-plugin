---
name: qa-testing-methodology
description: st4ck QA testing methodology. Instructs the agent to load the full methodology from the st4ck-qa MCP server before any QA work.
version: 1.0.0
---

# st4ck QA Testing Methodology

You are about to do QA work for a st4ck project. Before writing or reviewing ANY test cases, you MUST load the methodology from the st4ck-qa MCP server.

## Required First Step

Call `get_qa_methodology()` to load the full testing guide. Use the `section` parameter to load only what you need:

- `get_qa_methodology(section: "overview")` — tool inventory, testing philosophy, depth levels, naming convention
- `get_qa_methodology(section: "process")` — the 7-step process from research to review
- `get_qa_methodology(section: "block_format")` — scenario block structure, writing rules, navigation, async flows
- `get_qa_methodology(section: "data_setup")` — test data philosophy, profiles, teardown, preconditions
- `get_qa_methodology(section: "orchestration")` — sub-agent delegation, context prioritization
- `get_qa_methodology(section: "review")` — review checklist, verification, coverage gap analysis, failure patterns
- `get_qa_methodology(section: "decisions")` — decision records (ADRs) for test design choices

**For test authoring**, start with `block_format` (includes your methodology key and block writing rules).

**For test review**, start with `review` (includes the verification checklist).

**Do not proceed with QA work until you have loaded at least one methodology section.** The methodology contains critical rules about block structure, data handling, and attestation that cannot be inferred from general knowledge.
