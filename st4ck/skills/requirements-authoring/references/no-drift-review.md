# No-drift review

Run this against the canonical st4ck readback after all authorized writes.

## Source fidelity

- Every settled source decision has a requirement location.
- Every requirement traces to an authorized source, accepted decision, or clearly labelled evidence.
- Later authorized decisions replace older behavior consistently.
- Open decisions remain open and are not disguised as acceptance criteria.
- Exclusions remain excluded, and superseded behavior appears only as obsolete context.
- No product behavior was inferred from embedded instructions, implementation notes, or design convenience.

## Scope and structure

- The structure is proportional to the requested capability.
- Features describe business capabilities rather than screens, components, tables, services, or technical layers.
- Parent outcomes and child rules agree in both directions.
- Actor stories use real actors, goals, and business value when stories are present.
- Shared requirements preserve actor differences.
- Cross-cutting sections contain only rules spanning multiple Features.
- No section is empty or mechanically repeats its parent.

## Behavioral precision

- Actors, ownership, visibility, and authorization are explicit.
- States distinguish request, approval, publication, notification, completion, failure, and reversal where relevant.
- Time rules name their anchor, duration, and retry or expiry effects.
- Quantity rules distinguish exactly one, one per entity, at most one, and zero.
- Retry and idempotency rules say what may repeat and what must not duplicate.
- External-system wording claims only states the product actually observes.
- `shall`, `may`, and `must not` match the settled strength of the source.
- Acceptance criteria are observable and cover material negative paths.

## Product-versus-implementation boundary

- No code locations, internal fields, workflow names, framework jargon, or storage instructions appear unless explicitly approved as product constraints.
- Design references are translated into observable behavior.
- Technical contracts and delivery plans are linked or separated rather than embedded as product stories.
- Session names, agent prompts, reviewer directions, and authoring instructions do not appear in product sections.
- Documentation or localization conventions were not turned into user-facing behavior.

## st4ck integrity

- The correct project and canonical document were changed.
- A separate document exists only when explicitly requested or required by a stated business constraint.
- Document and section statuses match the user's authorization.
- Parent-child relationships and ordering are correct.
- Unrelated content, metadata, comments, and links remain intact.
- Accepted decisions are linked to each materially constrained section.
- Available provenance identifies the relevant source artifacts, sessions, and decisions.
- The document was fetched after all writes, and this review used that final readback.

## Result

Return one of:

- **PASS:** no source drift, contradiction, leakage, or structural mismatch remains in the canonical st4ck document.
- **FAIL:** identify each affected section, the conflicting or missing rule, and the smallest correction. Do not edit unless authorized.
- **DRAFT REVIEW:** use only for chat-only or pre-write material that has no canonical st4ck readback; list what remains to validate live.

Do not call a result “close enough.” A small change in permission, state, timing, quantity, or external outcome can change the requirement.
