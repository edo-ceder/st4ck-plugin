# Authoring notes — prd-from-source

Internal notes captured during the skill's design and early use. Not part of the SKILL.md a consuming agent reads. Items here may be promoted to the SKILL body once they're resolved.

## Open questions

- Should this skill require emitting a parallel ADR file when a code-only decision is discovered (e.g., "the platform deliberately uses two separate database triggers for supply vs demand")? Current take: yes, but as a recommendation, not a mandate.
- Should subagent dispatch include a *machine-checkable attestation format* (e.g., agents return JSON with `claim` + `source_path` + `source_line` fields)? Worth designing.
- Should the skill recommend a specific testing-framework binding (e.g., "every `user_flow` node maps to a Gherkin feature file")? Current take: don't bind to a framework — the PRD should be framework-agnostic and let the testing layer pick its own.
- How to handle migrations between major versions of the same product — the OpenSpec `delta:` marker covers brownfield diffs, but a *redesigned* feature deserves its own treatment (probably a versioned PRD branch).
