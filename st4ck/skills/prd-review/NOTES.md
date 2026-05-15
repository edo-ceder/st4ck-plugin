# Authoring notes — prd-review

Internal notes captured during the skill's design. Not part of the SKILL.md a consuming agent reads. Items here may be promoted to the SKILL body once they're resolved.

## Open questions

- Should there be a **fourth reviewer angle for Security/Privacy specifically**? The skill currently embeds privacy concerns into the PO and Dev passes, but data-handling regulations may warrant a dedicated lens. Likely a yes-but-optional, triggered when the PRD touches PII, payments, or compliance-bound data.
- Should reviewer prompts include an explicit "find at least N findings" requirement? Currently no — reviewers report what they actually find, which can be zero in late rounds. Risk: a tired reviewer phones it in. Mitigation: rotate the reviewer agents between rounds (different model temperatures, different prompt phrasings).
- Should reviewers be allowed to **propose new PRD nodes** that don't currently exist (i.e., flag missing decomposition)? Yes — but the finding's severity should reflect that adding a node is more work than fixing one.
- Is "diminishing returns" measurable enough to automate? The 30%-new + sub-MEDIUM heuristic is a starting point; with usage data it could be refined.
