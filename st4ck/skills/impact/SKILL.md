---
name: impact
description: Phase 5 §5.2 — agent-driven test impact analysis. Reads the local git diff, calls get_tests_affected_by_diff, creates test_design_change dev_tasks per affected component. Optionally invokes the propose subworkflow to attach proposed component diffs. Triggered explicitly via `/st4ck:impact` or auto on PostToolUse(Edit/Write) hits inside a cited file.
---

# /st4ck:impact

Analyze a local code diff and surface every QA test whose components cite the changed lines. Queue a `test_design_change` dev_task per affected component, assigned to QA.

## When this skill activates

| Trigger | Behavior |
|---|---|
| User runs `/st4ck:impact` | Full skill; ask whether to invoke `propose` |
| `PostToolUse` hook on Edit/Write hits a cited path (opt-in `hooks/post-edit-scan.sh`) | Auto-trigger silently; surface dev_tasks only if queued |
| User asks "what tests does my diff break?" | Activate; usually skip `propose` (read-only) |

## First actions — MANDATORY

1. **`git rev-parse --is-inside-work-tree`** must return true. Else error: *"This skill needs a local git checkout. Run from inside the project repo."*

2. **Identify diff scope.** Default `git diff HEAD^ HEAD`. `--base develop` → `git diff develop...HEAD`. `--staged` → `git diff --cached`.

3. **Capture metadata:** `repo_root` (`git rev-parse --show-toplevel`), `branch` (`git rev-parse --abbrev-ref HEAD`), `before_sha`/`after_sha`, `changed_files` (`git diff --name-only <range>`), per-file `changed_line_ranges` (parse `git diff -U0 <range> -- <path>` hunk headers `@@ -OLD,L +NEW,L @@`).

## Step-by-step

### 1. Build `changed_files`

```json
[{ "path": "src/pages/X.tsx", "changed_line_ranges": [{"start": 142, "end": 148}] }]
```

### 2. Call `get_tests_affected_by_diff`

Returns `{ affected_tests, affected_components, suggested_runs }`. If `affected_components.length === 0` → exit silently with "No QA tests cite the changed lines."

### 3. Per affected component, create a dev_task

```
create_dev_task({
  title: "Test design change: <component_name>",
  description: <brief 2-line summary>,
  source_type: 'test_design_change',
  source_id: <component_id>,
  assigned_team: 'qa',
  priority: 'medium',
  body: {
    repo_root, branch, before_sha, after_sha,
    affected_citations: [...],   // §5.2 schema
    suggested_reviewer_actions: [
      "read <changed file> at HEAD — confirm component's target UI is gone",
      "if flow retired: propose archiving test",
      "if flow moved: re-record against new location"
    ]
  }
})
```

Server fires `test_design_change_queued` on `test_coverage_events` (plan §5.6) — QA Kanban + active authoring sessions pick it up. No manual broadcast.

### 4. Optional: invoke `propose.md`

Only if user passed `--propose`. See `propose.md` in this skill folder. **Default: do NOT auto-invoke** — LLM-driven re-author per component is expensive.

## Safety rules

- **NEVER modify test or component records yourself.** Queue dev_tasks; QA reviews.
- **NEVER bypass line-range overlap.** Always provide `changed_line_ranges` — path-only matches spam the queue.
- **Debounce auto-trigger.** Don't recreate the same dev_task within 10s; server coalesces, you also rate-limit in hooks.
- **NEVER commit on behalf of the user.** Read git state, don't write.
- **NEVER run the runner from this skill.** Surface `suggested_runs`; user decides.

## Output

```
Impact analysis (branch: <branch>, range: <before_sha>..<after_sha>):
  - <N> affected components
  - <M> affected tests
  - <K> dev_tasks queued (assigned_team='qa')
  - Suggested runs:
    npx st4ck@latest run <test_id> <base_url>
```

If propose ran, append `Proposed diffs attached to <P> of <K> dev_tasks (confidence: low/medium/high)`.

## Skip conditions

- No files in `test_components.selector_notes.source_citations` touched → MCP returns zero; exit silently.
- Mid-merge/rebase (`MERGE_HEAD` / `REBASE_HEAD` present) → `git diff` inconsistent; skip with note.
- Initial commit (no HEAD^) → fall back to `git diff` (working tree vs HEAD) or skip.
