# QA Sub-Agent Dispatch Contracts

Shared dispatch prompt templates used by the `qa-testing-regression`, `qa-testing-version`, and `qa-testing-migration` skills to invoke the `qa-author` and `qa-reviewer` sub-agents.

**Why this file exists:** the three authoring-flow skills dispatch the same two sub-agents with the same structural prompt. Keeping one copy here prevents drift between the skills. Each skill provides its own CONTEXT fields; this file provides the frame.

---

## qa-author dispatch contract

When dispatching the `qa-author` sub-agent, compose a prompt with these sections in order. The skill fills in the CONTEXT fields; the INSTRUCTIONS block is copied verbatim.

```
## Test Authoring Assignment

### Context (filled by dispatching skill)

- **Intent:** [regression | version | migration]
- **Scope:** [module name | suite ID + journey table | legacy test IDs]
- **Suite ID:** [uuid — create_test_suite first, pass the id]
- **Suite Category:** [regression | version]
- **Profile IDs / Roles:** [role]=[uuid], [role]=[uuid]
- **Target feature or plan:** [what is being tested]
- **Source priority:** [code + running app (regression), plan + code (version), existing blocks + code (migration)]
- **Platform:** [bubble | react | native | ...]

### Approved coverage (CONTRACT)
[For version/regression: the Journey or Scope table the human already approved. Authors MUST implement every row with Status=Ready. MAY add edge cases. CANNOT drop planned flows.]
[For migration: the list of legacy test IDs to convert, with any human notes about which may become agentic.]

### Survey findings
- **App URL:** [url]
- **Key UI labels found:** [sidebar items, button text, form fields]
- **Routes:** [routes discovered]
- **User roles:** [roles + permissions]
- **Existing coverage:** [what's already tested — do not duplicate]
- **KB results:** [lessons from search_test_knowledge — platform quirks, timing issues, working patterns]

### INSTRUCTIONS (verbatim — do not paraphrase)

Your first action MUST be `get_qa_methodology(section: "block_format")`. Keep the returned `methodology_key` — you will echo it in `methodology_attestation` on every create_test_case / modify_test_case call. It has a 2-hour TTL; re-fetch if expired.

Follow the methodology you just fetched. Key non-negotiables the server enforces:

- Every component you reference must pass SELECTOR QUALITY RULE. Never bare tags (`querySelector('h1')`). For non-semantic elements with no ARIA role, use runner primitives `click_by_text` / `hover_by_text` / `type_by_text` with optional `scope: "dialog"`.
- Every new component must complete the CODE + SNAPSHOT + KB TRIAD in `selector_notes` before `save_component`: (a) source file:line, (b) snapshot excerpt showing role/ref/wrapping, (c) cited KB entry ID or "searched, nothing matched". Missing any leg fails review.
- Test interactively with agent-browser before saving any component. Never save untested.
- DATA REALISM: every specific value a block clicks (category, merchant, option) MUST exist for the target profile at runtime — verify via snapshot, SELECT, or a fixture the test itself seeds. Hard-coding values that do not exist is a canonical failure.
- Block structure: ≤15 actions per block. `role` on component-format frontend blocks (not `profile_id`). Backend blocks SELECT-only. Use UI navigation after login — never direct URLs.
- Test ONE first. Author a single test, verify it can run, then batch the rest.

### Output

When done, report:
- Suite ID + list of test case IDs created
- Coverage mapping: which row of the approved table / which legacy test maps to which new test
- Research artifact excerpt (`<sources_read>` must list every file you cited)
- Any gaps you could not cover + reason
```

---

## qa-reviewer dispatch contract

When dispatching the `qa-reviewer` sub-agent, compose a prompt with these sections. The reviewer MUST be a different sub-agent instance than the author (the server rejects signatures with `is_independent_reviewer: "no"`).

```
## Test Review Assignment

### Context (filled by dispatching skill)

- **Test case IDs to review:** [list]
- **Suite ID:** [uuid]
- **Author sub-agent:** [was a separate instance — you did NOT author these]
- **Platform:** [bubble | react | ...]

### INSTRUCTIONS (verbatim — do not paraphrase)

Your first action MUST be `get_qa_methodology(section: "review")`. Keep the returned `methodology_key` — you will echo it in `review_test` and `sign_test_review` calls. 2-hour TTL.

Independence is non-negotiable. The server will hard-reject `sign_test_review` if `is_independent_reviewer: "no"`. If you somehow authored any of these tests, refuse and report back.

Follow the review checklist you just fetched (the methodology's review section). For each test:

1. `review_test(test_case_id)` → returns the test body + `review_token`.
2. Run the checklist. Read source code for every UI string, route, column, and DOM selector cited. Grep before trusting.
3. For component-format tests: verify COMPONENT TRIAD COMPLETENESS on every referenced component (code + snapshot + KB). Missing any leg = reject.
4. For every data-mutating block: seed → verify seed → assert → cleanup pattern present.
5. `sign_test_review` when all checks pass. Attestation fields get cross-validated server-side against actual block content — do not attest falsely.

If any check fails, do NOT sign. Report specific failures to the orchestrator with file:line evidence.

### Output

For each test:
- **Verdict:** PASS / FAIL
- **Checklist result:** [X/N items passed]
- **Evidence:** file:line citations for everything you verified
- **Issues:** specific failures with evidence (if any)
- **Signed:** Yes / No (reason if No)

Plus coverage-gap analysis across the suite at the end.
```

---

## How skills use this file

Each dispatching skill includes this file via:

```
@${CLAUDE_PLUGIN_ROOT}/shared/qa-dispatch-contracts.md
```

Then fills CONTEXT fields specific to its intent. The INSTRUCTIONS blocks are always copied verbatim — never paraphrase them, or sub-agents will drift.
