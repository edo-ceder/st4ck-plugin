# Proportional requirement structure

Select a structure based on the capability's breadth and behavioral complexity. Remove sections that add no information.

## Focused capability

Use this shape for a small or contained feature:

1. **Outcome:** why the capability exists and what becomes true.
2. **Actors and scope:** who may see or act, relevant boundaries, and exclusions.
3. **Business rules:** settled state, ownership, timing, quantity, permission, and failure rules.
4. **Acceptance criteria:** observable success, negative, and retry behavior.
5. **Dependencies and open decisions:** missing inputs, owner, and blocked behavior.

Add a user story only when actor, goal, and business value clarify the requirement. Do not wrap every rule in “As a user.”

## Multi-capability journey

Use more hierarchy when multiple business capabilities or actor paths must work together.

### Epic overview

Describe the starting actor and trigger, major state changes and gates, decision ownership, and final business outcome. Include a compact Feature map when it improves navigation.

### Features

Divide Features by business capability or a meaningful stage of the journey. Each Feature begins with the outcome it owns and contains only the rules and actor paths needed to achieve it.

### Shared requirements

Use a shared requirement when multiple actor paths depend on the same rule. State common behavior once, but never use sharing to erase differences in permission, visibility, action, or outcome.

### Actor-specific stories

Keep actor stories separate when their goals or authority differ:

`As a <business actor>, I want <capability or decision>, so that <business value>.`

Place shared rules in the shared requirement and actor-specific rules in the story.

### Cross-cutting behavior

Use a cross-cutting section only for rules that genuinely span multiple Features, such as lifecycle meanings, authorization, privacy, audit, retention, or externally observable state. A rule used by one Feature stays with that Feature.

### End-to-end acceptance journeys

Add a small number of scenarios that cross Feature boundaries when they expose important handoffs, failure recovery, repeat behavior, authorization boundaries, or retention effects. They complement rather than duplicate section-level criteria.

## Acceptance criteria

Use business-observable Given/When/Then outcomes:

- **Given** the relevant starting state, **when** the actor or system performs the trigger, **then** the observable outcome occurs.
- Include negative, duplicate, retry, and permission cases when they protect settled behavior.
- Do not use internal fields, functions, components, or storage operations as the acceptance target.
- Do not invent a criterion for an unresolved decision. Name the missing criterion and required owner decision under Open Decisions.

## Dependencies, decisions, and boundaries

- **Dependencies:** missing input, owner, and what it blocks.
- **Open decisions:** the exact unresolved question and the behavior it prevents from being finalized.
- **Out of scope:** explicitly excluded behavior, without a promise to build it later.
- **Superseded interpretations:** obsolete rules only where someone might otherwise reintroduce them.

## Correlation checks

- Every Feature fulfills part of the Epic when an Epic exists.
- Every child section fulfills part of its parent outcome.
- Every shared requirement serves multiple actor paths.
- Every cross-cutting rule applies to multiple Features.
- No child section introduces a business capability absent from its parent scope.

If a check fails, move, split, merge, or remove the section rather than adding explanatory ceremony.
