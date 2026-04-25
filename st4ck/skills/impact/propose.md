# /st4ck:impact — propose subworkflow

Optional second step of the `impact` skill. Generates a proposed component update for each affected component, attached to the corresponding `test_design_change` dev_task as `body.proposed_diff`.

**Run only when the user explicitly requested `--propose`** or the parent dev agent decided to invoke it. The default impact run does NOT propose — proposals are LLM-driven and expensive.

## What you produce

For each affected component, you generate:

```json
{
  "component_id": "<uuid>",
  "new_sequence": [...],           // proposed v2 sequence using current primitive registry
  "new_citations": [
    {"path": "<changed file>", "line": <new line>, "git_sha": "<after_sha>"}
  ],
  "generated_by": "st4ck:impact skill",
  "generated_at": "<ISO timestamp>",
  "confidence": "low" | "medium" | "high"
}
```

…and patch the dev_task via:
```
update_dev_task({task_id, body: {...existing_body, proposed_diff: <above>}})
```

## Procedure (per affected component)

### Step 1 — Fetch the component

`get_component({name, method})` — pull current `sequence`, `selector_notes.source_citations`, `params_schema`, `platform`.

### Step 2 — Read the BEFORE and AFTER versions of each cited file

For each citation in the component's `source_citations`:
- `git show <before_sha>:<path>` → before content (the file as the test was authored against)
- `git show <after_sha>:<path>` → after content (the file the test should re-target)

If the path no longer exists at `after_sha` (file was deleted) — emit `confidence: 'low'` proposal with `new_sequence: null` + `new_citations: []` + `recommendation: 'flow likely retired; consider archiving the test'`. Don't try to invent a new sequence.

### Step 3 — Diff the cited line range across versions

Compare lines `[citation.line ± 5]` before vs after. Three patterns:

**a. Selector renamed (testid changed, role+name changed):** propose updated selector. Confidence `medium`.

**b. Element moved within the same file:** propose updated line numbers. Confidence `high`.

**c. Element gone, surrounding code refactored:** propose `confidence: 'low'` with `recommendation: 'manual re-record needed'`. Don't fabricate a new selector.

### Step 4 — Validate proposed selectors against current source

For any new selector you propose, grep the entire repo at `after_sha`:
- If the new selector matches exactly 1 element → `confidence: 'high'`
- If matches 2-5 → `confidence: 'medium'` (caller may need to add scope)
- If matches 0 or >5 → `confidence: 'low'`; flag and don't auto-apply

### Step 5 — Cap iteration

Per plan §11.1 LLM budget cap: $2/call authoring max. The propose subworkflow stays cheap because it's read-only (grep + git show + 1 LLM call to generate the new sequence). Hard cap: 3 LLM turns per component. If you can't produce a proposal within 3 turns, emit `confidence: 'low'` + `recommendation: 'manual re-record needed'` and move on.

### Step 6 — Patch the dev_task

```
update_dev_task({
  task_id: <the test_design_change task created in main impact skill>,
  body: {
    ...existing_body,
    proposed_diff: {
      component_id,
      new_sequence,
      new_citations,
      generated_by: 'st4ck:impact propose subworkflow',
      generated_at: <ISO>,
      confidence,
      recommendation? // present only when confidence='low'
    }
  }
})
```

## What QA does with the proposal

The dev_task lands on the QA Kanban with `body.proposed_diff` filled in. QA reviewer:
- High confidence → may apply directly via `modify_test_case` (component_id-targeted) and re-run
- Medium → reviews + tweaks selector before applying
- Low → ignores the proposal; manually re-records via `qa-author` against the new UI

## Hard rules

- **Never apply the proposal yourself.** You patch the dev_task body; QA decides.
- **Never overwrite a proposed_diff that already has a higher-confidence version.** If the dev_task already has `proposed_diff.confidence='high'`, leave it alone (you'd be downgrading).
- **Cap proposals per skill run.** If the impact analysis surfaces >20 affected components, emit only the first 20 proposals + a summary saying "more proposals deferred — re-run /st4ck:impact --propose with `--limit 50` if needed". Avoid runaway LLM spend.
