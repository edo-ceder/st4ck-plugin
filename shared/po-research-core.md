# PO Research — Phases 1-4

This file contains the generic research phases shared between the st4ck plugin's `/po-research` command and the standalone `po-research-plugin`.

## Phase 1: Discovery

Understand what the PO wants and why.

1. **Parse the input**: Read the feature description, spec document, or prompt
2. **Clarify scope**: What is the PO trying to achieve? What's the business goal?
3. **Identify assumptions**: What does the PO assume already exists or works?
4. **Note open questions**: What information is missing from the input?

Present a brief summary:
```
Here's what I understand you want to build:
- [Feature summary in plain language]
- Business goal: [why this matters]
- Key assumptions: [what you're assuming exists/works]
```

If anything is unclear, ask before proceeding.

## Phase 2: Codebase Exploration

Launch 2-3 **codebase-explorer** agents in parallel to understand the current state:

**Agent A — Similar Features & Patterns**:
- Search for features similar to what's being requested
- How are they structured? What patterns do they follow?
- What utilities and components are reused?

**Agent B — Data Model & Infrastructure**:
- Current database schema relevant to this feature
- Existing API endpoints and service patterns
- Authentication and authorization model

**Agent C — Architecture & History** (if the feature is complex):
- Overall architecture boundaries and module organization
- Recent git history in relevant areas
- Active development areas and potential conflicts

After agents return, synthesize into a **PO-friendly summary**:

```
## What Exists Today

### Relevant Features
[Plain-language description of similar features that already exist]

### Foundation Available
[What infrastructure, components, and patterns can be reused]

### Technical Landscape
[Any architectural constraints or opportunities the PO should know about]
```

Do NOT dump technical details. Translate everything into business/product language.

## Phase 3: Logic Gaps & Unsolved Issues

This is the most valuable phase. Challenge the PO's thinking — find what's incomplete, contradictory, or missing.

Analyze the requirements against the codebase findings and identify:

### Blockers (must resolve before building)
Issues that would stall development if not addressed:
- Missing decisions (e.g., "what happens when X and Y conflict?")
- Contradictions between requirements
- Dependencies on features/infrastructure that don't exist yet

### Important (should resolve, can unblock partially)
Issues that affect quality or scope:
- Missing edge cases (empty state, error state, concurrent users)
- Unclear business rules (e.g., "who can see what?")
- Performance implications not considered

### Nice to Clarify (won't block, but helps)
Issues that improve the feature if addressed:
- UX details not specified
- Analytics/tracking requirements
- Future extensibility questions

Present each issue as a specific question:
```
### Blockers
1. **[Short title]**: [Specific question the PO needs to answer]
   _Why this matters_: [1 sentence on what breaks if unanswered]

### Important
2. **[Short title]**: [Specific question]
   _Why this matters_: [1 sentence]
```

**STOP. Wait for PO answers before proceeding to Phase 4.**

The PO's answers feed directly into the solution analysis. Don't skip this gate — solutions without resolved logic gaps produce inaccurate effort estimates.

## Phase 4: Solution Options

After the PO resolves blockers and important issues, launch 2-3 **solution-analyst** agents in parallel:

**Agent 1 — Minimal Viable Approach**:
- What's the smallest thing that delivers core value?
- What's deferred? What's the upgrade path?

**Agent 2 — Full Implementation**:
- Everything the PO asked for, built properly
- Full effort and risk assessment

**Agent 3 — Alternative Approach** (if applicable):
- A different way to solve the same problem
- Trade-offs compared to the standard approach

After agents return, present a comparison:

```
## Solution Options

| | Minimal | Full | Alternative |
|---|---------|------|-------------|
| **Delivers** | [what] | [what] | [what] |
| **Defers** | [what] | [nothing] | [what] |
| **Effort** | [T-shirt] | [T-shirt] | [T-shirt] |
| **Risk** | [Low/Med/High] | [Low/Med/High] | [Low/Med/High] |
| **Key trade-off** | [1 sentence] | [1 sentence] | [1 sentence] |

### Recommendation
[Which option and why, in the context of the PO's stated goals and constraints]
```

**STOP. Wait for PO to choose an approach.**

The chosen approach feeds into Phase 5 (requirements authoring), which varies between the st4ck plugin and standalone plugin.
