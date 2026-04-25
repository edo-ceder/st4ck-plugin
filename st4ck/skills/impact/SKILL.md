---
name: impact
description: Phase 5 §5.2 — agent-driven test impact analysis. Reads the local git diff, calls get_tests_affected_by_diff, creates test_design_change dev_tasks per affected component. Optionally invokes the propose subworkflow to attach proposed component diffs. Triggered explicitly via `/st4ck:impact` or auto on PostToolUse(Edit/Write) hits inside a cited file.
---

# /st4ck:impact

You analyze a local code diff and surface every QA test whose components cite the changed lines. For each affected component, you create a `test_design_change` dev_task assigned to QA, with optional `proposed_diff` payload.

## What the skill does (high level)

1. Read the dev agent's local git diff (HEAD vs HEAD^, or against a base branch).
2. Call `get_tests_affected_by_diff` MCP tool with the changed files + line ranges.
3. For each affected component, create a `test_design_change` dev_task with the §5.2-ready payload.
4. Optionally — only if invoked with `--propose` or by the user explicitly — invoke the `propose.md` subworkflow per affected component to generate a proposed component diff.

## When this skill activates

| Trigger | Behavior |
|---|---|
| User runs `/st4ck:impact` explicitly | Full skill; ask user whether to invoke propose subworkflow |
| `PostToolUse` hook on Edit/Write of a file matching any cited path (opt-in via `hooks/post-edit-scan.sh`) | Auto-trigger the skill silently; surface dev_tasks to user only if any are queued |
| User asks "what tests does my diff break?" | Activate the skill; usually skip propose (read-only inspection) |

## First actions — mandatory

1. **Confirm a local repo exists.** `git rev-parse --is-inside-work-tree` must return true. If not, error out with: *"This skill needs a local git checkout. Run from inside the project repo."*

2. **Identify the diff scope.** Default: `git diff HEAD^ HEAD`. If the user passed a base branch (e.g. `--base develop`): `git diff develop...HEAD`. If `--staged`: `git diff --cached`.

3. **Capture diff metadata:**
   - repo_root: `git rev-parse --show-toplevel`
   - branch: `git rev-parse --abbrev-ref HEAD`
   - before_sha + after_sha for the diff range
   - changed_files: `git diff --name-only <range>` for the file paths
   - changed_line_ranges per file: parse `git diff -U0 <range> -- <path>` hunk headers (`@@ -OLD,L +NEW,L @@`)

## Step-by-step

### 1. Build the changed_files payload

```json
[
  {
    "path": "src/pages/BudgetCreationDialog.tsx",
    "changed_line_ranges": [{"start": 142, "end": 148}, {"start": 220, "end": 220}]
  }
]
```

### 2. Call `get_tests_affected_by_diff`

```
get_tests_affected_by_diff({changed_files})
```

Returns:
```json
{
  "affected_tests": [{"test_id", "test_name", "citations": [...]}],
  "affected_components": [{"component_id"}],
  "suggested_runs": ["st4ck-runner run <test_id> <base_url>"]
}
```

If `affected_components.length === 0`, exit silently — nothing to do. Tell the user "No QA tests cite the changed lines."

### 3. Per affected component, create a dev_task

For each unique component_id in the response:

```
create_dev_task({
  title: "Test design change: <component_name>",
  description: <brief 2-line summary>,
  source_type: 'test_design_change',
  source_id: <component_id>,
  assigned_team: 'qa',
  priority: 'medium',
  body: {
    repo_root,
    branch,
    before_sha,
    after_sha,
    affected_citations: [...],   // per §5.2 schema
    suggested_reviewer_actions: [
      "read <changed file> at HEAD — confirm component's target UI is gone",
      "if flow retired: propose archiving test",
      "if flow moved: re-record against new location"
    ]
  }
})
```

Per plan §5.6, `create_dev_task` with `source_type='test_design_change'` server-side fires a `test_design_change_queued` event on `test_coverage_events` — the QA Kanban + authoring-lead pick it up automatically. You don't need to broadcast.

### 4. Optionally invoke `propose.md` subworkflow

If the user passed `--propose` (or the explicit slash command activated with that flag), invoke the propose subworkflow per affected component. See `propose.md` in this skill folder for the full procedure. The subworkflow reads before+after file contents, generates a proposed component update, then patches the dev_task via `update_dev_task` with `body.proposed_diff` set + `confidence: low | medium | high`.

Default: do NOT auto-invoke propose. It's expensive (LLM-driven re-author per component) — only run when explicitly requested.

## Safety rules

- **Never modify the test or component records yourself.** You queue dev_tasks; QA reviews.
- **Never bypass the line-range overlap.** Path-only matches (no line range) are too coarse — they spam the QA queue. The MCP tool already does line-range filtering when you provide `changed_line_ranges`; always provide them.
- **Debounce auto-trigger.** Per plan §5.6 debounce: don't create the same dev_task twice within 10s. The MCP tool's `test_design_change_queued` event coalesces server-side; you should also rate-limit your dev_task creation if running in a hook.
- **Never commit on behalf of the user.** Read git state, don't write.
- **Never run the runner from this skill.** The dev_task contains `suggested_runs` for the user; they decide whether to run.

## Output format

After the skill runs, surface to the user:

```
Impact analysis (branch: <branch>, range: <before_sha>..<after_sha>):
  - <N> affected components
  - <M> affected tests
  - <K> dev_tasks queued (assigned_team='qa')
  - Suggested runs:
    st4ck-runner run <test_id_1> <base_url>
    st4ck-runner run <test_id_2> <base_url>
    ...
```

If propose was invoked, append:
```
  - Proposed diffs attached to <P> of <K> dev_tasks (confidence: low/medium/high distribution)
```

## When to NOT run

- The diff touches no files in `test_components.selector_notes.source_citations` — the MCP tool will return zero affected tests; exit silently.
- The dev agent is mid-merge or rebase — `git diff` is in an inconsistent state. Detect via `git rev-parse --git-dir` checking for `MERGE_HEAD` / `REBASE_HEAD` and skip with a note.
- Running on the initial commit (no HEAD^) — fall back to `git diff` (working tree vs HEAD) or skip.
