---
name: qa-testing-methodology
description: st4ck QA test authoring methodology for sub-agents — deep dive, strategy with edge cases, block format, data philosophy, review checklist. Covers steps 3-7 of the process (steps 1-2 are the orchestrator's job).
---

# st4ck QA Testing Methodology

This skill is injected into your context by the orchestrator. It covers **how to author tests** (steps 3-7). The orchestrator already handled steps 1-2: exploring the running app, interviewing the user, and agreeing on scope. You receive that context in your dispatch prompt.

**Before creating any test case**, call `get_qa_methodology()` once to obtain a `methodology_key` (required by `create_test_case`). You don't need to read its content — everything is in this skill.

---

## Testing Philosophy

st4ck QA verifies that web applications work correctly from the user's perspective. The system has three layers:

- **Suites** — top level, group related tests by module and purpose (e.g., "Expenses Regression"). Category: `regression` or `version`.
- **Test cases** — one scenario each, with step-by-step instructions inside a suite.
- **Scenario blocks** — building blocks inside a test case. Each block runs in a browser (frontend) or against the database/API (backend). Typically 3-8 blocks per test.

### Source Priority: Code-First

Use the best source available, in this order:
1. **Code + running app** — read the code AND explore the running app via browser. This is the DEFAULT.
2. **Requirements/specs** — ONLY if the user provides them or they are already in context. Do NOT proactively fetch PRD/specs/requirements.
3. **Plan** — if a development plan exists, derive scenarios from its phases and acceptance criteria.

### Two-Dimension Classification

**Category** (on the suite) — when and why:
- `version` — features being shipped in the current release. Archived or promoted after the version ships.
- `regression` — protects shipped features. Runs on every deploy. The permanent safety net.

**Type** (on the test case) — what kind of test:
- `smoke` — critical path gate check. Shallow and fast. 1-2 blocks OK. 5-15 tests covering login, navigation, critical CRUD.
- `sanity` — targeted check after a specific change. Narrow scope.
- `e2e` — end-to-end user journey through the browser. The most important type and the default. Must be SELF-CONTAINED (creates all data via UI), MULTI-BLOCK (3-8 minimum), FULL JOURNEY (login through verification), and INDEPENDENT (runs in any order on a fresh environment).
- `acceptance` — business requirements validation (UAT). Same structural requirements as e2e but written from the business perspective.
- `integration` — cross-module, API, or data flow verification. May depend on pre-existing data if scope is specifically about module interaction.
- `unit` — one thing in isolation. Can be single-block.

### Depth Levels

- **Quick sanity** — 2-5 tests, critical path only. After a hotfix or minor change.
- **Standard regression** — 10-20 tests per module. Happy paths, key error cases, access control boundaries. The default.
- **Shipping-ready comprehensive** — 20-40+ tests per module. Every edge case, permission boundary, error message. Nothing ships without passing this level.

### Test Naming Convention

Pattern: `[Module] [Feature] — [Scenario]`

Examples:
- `Expenses CRUD — Add variable expense with merchant and category`
- `Auth Login — Invalid credentials show error message`
- `Budget View — Cycle-based month navigation preserves filters`
- `Access Control — Viewer cannot access settings tab`

### Core Principle: Test What the User Sees

Every test should ultimately verify something the user can observe on screen. Backend blocks (SQL checks) confirm data persistence, but a test that only checks SQL is incomplete. If a feature works, it should be provable by navigating the app and reading what is displayed.

---

## Your Process (Steps 3-7)

The orchestrator handled steps 1-2 (app exploration, user interview, scope agreement). You start at step 3. Do not skip or reorder — each step produces context the next step depends on.

### Step 3: Deep Dive into the Code

This is NOT the light scan from Step 1 — this is thorough, line-by-line reading.

For every feature under test, read:
- The route handler or API endpoint
- The main UI component (page, dialog, form)
- The hooks or services that connect UI to data
- The database schema for tables involved (use `supabase_describe_table`)
- Any shared utilities (formatters, validators, permission checks)

**Distinguish live code from dead code:**
- Is the component actually rendered? Grep for `<ComponentName` in parent files. Zero matches = dead.
- Is the route actually registered? Check the router config.
- Is the API endpoint actually called from the frontend? Grep for the URL path.

**Build a research artifact** as you go. One per feature area or group of related tests that share the same source files. For a 45-test suite you might produce 4-6 artifacts, not 45.

For each feature area, document:
- What files you read and what you found
- UI strings (exact button labels, error messages, placeholders — copy from source, cross-check with what you saw in the browser)
- Database columns involved (name, type, nullable, defaults)
- API routes (method, path, file, line number)
- Enum values and valid states
- What the user sees when they perform each action (the observable outcomes)

#### Research Artifact Template

```xml
<research_artifact module="[module name]">
  <sources_read>
    <file path="[file path]" reason="[what you looked for]" />
  </sources_read>
  <ui_strings>
    <string value="[exact text from source]" file="[file path]" line="[line number]" />
  </ui_strings>
  <schema_columns table="[table name]">
    <column name="[column]" type="[type]" nullable="[yes/no]" default="[value or none]" />
  </schema_columns>
  <api_routes>
    <route method="[GET/POST/etc]" path="[route path]" file="[file path]" line="[line number]" />
  </api_routes>
  <enum_values>
    <enum name="[enum/type name]" values="[comma-separated values]" file="[file path]" line="[line number]" />
  </enum_values>
  <payload_interfaces>
    <interface name="[interface name]" file="[file path]" line="[line number]">
      <field name="[field name]" type="[type]" />
    </interface>
  </payload_interfaces>
  <render_chain>
    <component name="[component]" imported_by="[parent file]" rendered_when="[condition or 'always']" grep_jsx_match="[yes/no]" />
  </render_chain>
  <flow_steps source_file="[file path]" config_name="[config array name]">
    <step id="[number]" name="[step name]" />
  </flow_steps>
  <user_outcomes>
    <outcome action="[what the user does]" observable="[what changes on screen]" screen="[where to verify]" />
  </user_outcomes>
</research_artifact>
```

Every value in the artifact MUST trace back to a file you actually read. If you cannot find it, mark it "unverified" and resolve it before writing the test.

### Step 4: Propose a Testing Strategy

Present a concrete plan before writing any tests:

- Suite name and category (regression or version)
- Test list with names (following naming convention), types, and priorities
- Grouping — by feature area, user flow, or risk level
- Coverage gaps — what you are intentionally not covering and why
- Estimated count by depth level

**Edge case discovery is mandatory at this step.** For each feature area, explicitly consider:

| Category | Examples |
|----------|----------|
| Empty states | No data yet, first-time user, cleared history |
| Boundary values | Zero, negative, max length, special characters, Unicode |
| Permission boundaries | Viewer doing owner actions, cross-tenant access, expired sessions |
| Error states | Network failure, invalid input, duplicate submission, timeout |
| Concurrent users | Two users editing same record, race conditions |
| Lifecycle transitions | Status changes (draft to published), state machine edges, undo/redo |

Include edge cases in the test list from the start — not as an afterthought.

Example strategy:

```
Expenses Module — Standard Regression (15 tests)

CRUD Operations (5 tests, e2e):
- Expenses CRUD — Add variable expense with merchant and category [high]
- Expenses CRUD — Edit expense amount and date [medium]
- Expenses CRUD — Delete expense with confirmation [medium]
- Expenses CRUD — Add fixed/commitment expense [high]
- Expenses Validation — Duplicate expense name validation [low]

Filtering & Views (4 tests, e2e):
- Expenses View — Switch between variable and fixed tabs [high]
- Expenses View — Cycle-based month navigation [critical]
- Expenses View — Category-first vs merchant-first sort toggle [medium]
- Expenses View — Empty state when no expenses exist [medium]

Access Control (2 tests, integration):
- Expenses Access — Regular user cannot see other users' expenses (RLS) [critical]
- Expenses Access — Read-only user cannot create expenses [high]
```

Return this strategy to the orchestrator for confirmation before writing tests. If you are writing tests directly (not via orchestrator), present the strategy in your output before proceeding.

### Step 5: Prepare for Execution

1. **Test profiles**: Use the profile IDs from your dispatch prompt. If not provided, call `get_test_profiles` for real profile UUIDs. If NO profiles exist, create them with `create_test_profile` — you need at least one profile per user role the tests will exercise. NEVER skip tests or declare "blocked" because profiles don't exist. Every frontend block needs a `profile_id`.
2. **Suite**: Use the suite ID from your dispatch prompt. If not provided, call `create_test_suite` with the agreed name, category, and module.
3. **Methodology key**: Call `get_qa_methodology()` to obtain the `methodology_key` required by `create_test_case`.

### Step 6: Write the Tests

**Test ONE first.** Author a single test case and self-review it against the checklist before batching the rest. Do not batch-author 42 tests based on an unverified pattern. If the first test has issues, fix the pattern before applying it to remaining tests.

Every test MUST follow the block format rules (next section) and create its own preconditions.

### Step 7: Review

After all tests are written, review every test against the verification checklist (Review section below). You MUST review until the checklist passes clean with zero failures. If a review finds issues, fix them and review again. Repeat until clean — fixes can introduce new issues.

If reviews consistently fail after 3+ cycles, something upstream is wrong — revisit Step 3 (research) or Step 5 (instructions). Stop, diagnose, fix root cause.

---

## Block Format

Every rule here is a hard constraint.

### Scenario Block Structure

```json
{
  "block": 1,
  "block_type": "frontend | backend",
  "run_type": "serial",
  "browser_window": 1,
  "profile_id": "uuid",
  "critical": true,
  "actions": [
    { "action": "what the user does", "expected": "what should happen" }
  ],
  "expected_outcome": "summary of block outcome"
}
```

### Block Types

**Frontend blocks** — browser/UI steps. Actions describe what the user does: click, type, verify text. MUST have `profile_id` set. Without it, credentials resolve to null and the block fails silently.

**Backend blocks** — READ-ONLY verification. SELECT queries or API GET checks ONLY. NEVER INSERT, UPDATE, DELETE, or any data-mutating SQL. If you need data, create it through the UI in a frontend block.

Keep frontend and backend steps in separate blocks. Never mix them.

### Critical vs Non-Critical

Mark a block `critical: true` when subsequent blocks depend on its success. Setup blocks are critical. Edge case and validation blocks can be non-critical.

### Block Size Limit

**Maximum 7 actions per block.** If a sequence needs more, split at natural boundaries: setup, core action, verification, cleanup.

### Multi-User Scenarios

Use multiple `browser_window` numbers for multi-user tests. Reuse the same number across blocks to persist session state. Maximum 3 browser windows per scenario.

### Writing Test Steps

Steps describe what a user sees and does — visible labels, button text, form fields. Write so a QA engineer unfamiliar with the codebase can follow. Reference elements by visible text ("click the 'Save Changes' button"), not component names or CSS selectors.

Keep test data dynamic: "pick a merchant from the list" not "select merchant ID abc-123."

### Specific Expected Outcomes

Every expected outcome MUST include specific, verifiable content — exact text strings, counts, amounts, or state descriptions.

**Bad:** `expected: "Fixed expenses content is displayed"`
**Good:** `expected: "The fixed expense 'Rent' with amount 3,500 appears in the list"`

**Bad:** `expected: "Chart updates"`
**Good:** `expected: "The bar chart shows 3 bars for Jan, Feb, Mar with the selected category highlighted"`

Ask yourself: "Could this assertion pass if the feature is broken?" If yes, make it more specific.

### Frontend Navigation

After the initial login page URL, navigate through the app's UI: sidebar clicks, tab selections, menu items, breadcrumbs, buttons. This catches broken links and routing bugs that direct URL navigation would bypass. If a page cannot be reached via visible UI navigation, report it as unreachable.

Exception: testing deep link behavior specifically.

### SVG and Chart Components

Charts (Recharts, D3, Chart.js) produce SVG that is not reliably accessible through accessibility snapshots.

- Test data-driven outcomes, not visual properties. Verify summary text or legend values.
- For interactive features, test the data output (e.g., "after clicking 'Food' segment, expenses list filters to Food only").
- Mark unassertable visual properties as "visual verification required" and set block non-critical.

### Asynchronous and Webhook Flows

- The action block describes the trigger and immediate UI feedback.
- Add a separate verification block for the async result. Use action text like "Wait for the response to appear in the conversation thread."
- Set the verification block as non-critical if timing is unreliable.

### Block Count by Test Type

| Type | Blocks | Notes |
|------|--------|-------|
| smoke/sanity | 1-2 | Quick checks |
| e2e/acceptance | 3-8 minimum | MUST include: data creation via UI, core action, verification. A 1-block e2e is ALWAYS wrong. |
| integration | 2-5 | May start with backend setup if testing cross-module flow |
| unit | 1-2 | One thing in isolation |

If exceeding 10 blocks, consider splitting into separate test cases.

### Example Scenario (Schematic)

```
Block 1 (frontend, critical: true, profile: "owner", window: 1):
  actions: [
    { action: "Navigate to sidebar > 'Projects'", expected: "Projects list is visible" },
    { action: "Click 'New Project' button", expected: "Create project dialog opens" },
    { action: "Type 'Test Project {{timestamp}}' in name field, click 'Create'", expected: "Redirected to new project page" }
  ]

Block 2 (frontend, critical: true, profile: "owner", window: 1):
  actions: [
    { action: "Click 'Settings' tab", expected: "Settings panel opens" },
    { action: "Toggle 'Enable notifications' on, click 'Save'", expected: "Success toast appears" }
  ]

Block 3 (backend, critical: true):
  actions: [
    { action: "SELECT count(*) FROM projects WHERE created_by = '{profile_user_id}' AND notifications_enabled = true ORDER BY created_at DESC LIMIT 1", expected: "1" }
  ]

Block 4 (frontend, critical: false, profile: "viewer", window: 2):
  actions: [
    { action: "Navigate to sidebar > 'Projects', click the newly created project", expected: "Project page loads" },
    { action: "Verify 'Settings' tab is not visible", expected: "Tab is absent — viewers cannot access settings" }
  ]
```

Block 1-2 set up via UI (critical). Block 3 verifies backend persistence using `{profile_user_id}` (not hardcoded). Block 4 tests a permission edge case with a different role (non-critical).

---

## Data Philosophy

### Every Test Creates Its Own Preconditions

**NEVER assume the app is in a specific state.** Block 0 or Block 1 of every test MUST set up what the test needs. If the shop must be open, the test opens it. If a user must exist, the test creates one via the UI.

Be EXPLICIT in precondition blocks. Do not write "Ensure the shop is open." Write the actual steps: which buttons to click, what sidebar states to look for, what confirmations to dismiss. Use the actual labels you saw in the browser.

**Wrong:** "Ensure shop is open"
**Right:** "Log in as Distributor. Check sidebar for action button. If you see 'Open Shop' — click it, confirm. Keep clicking action buttons until 'Close Shop' is visible in sidebar — that means the shop is open."

### The Self-Sufficiency Test

Imagine a fresh database with only auth credentials. Would this test pass? If not, what is missing? Whatever is missing must be created by earlier blocks in the test.

- Need a user? Block 1 signs up through the registration flow.
- Need an expense record? A block navigates to expenses and creates one via the UI.
- Need many records? Use the app's data entry flow repeatedly, or its bulk import feature if one exists.
- Need a clean slate? Navigate to settings and use the app's data reset feature through the UI.
- Need data from another role? Use a multi-role block with a different profile.

### Common Self-Sufficiency Failures

These pass in demo but fail in CI:
- "Navigate to orders page and verify orders are listed" — what orders? Who created them?
- "Filter expenses by category 'Food'" — who created Food expenses?
- "Verify the dashboard shows 3 active projects" — who created them? On what timeline?
- Block 0 uses INSERT INTO to seed rows — who would do this in real life? Nobody.

### Tests Create Data Through the UI — Non-Negotiable

If the test needs 10 records, create 10 through the app's data entry screens. If the app has bulk import or batch creation, use that feature through the UI.

Backend blocks are for READ-ONLY verification (SELECT). They MUST NEVER contain INSERT, UPDATE, DELETE, or any data-mutating statement. A backend block that seeds data is a methodology violation.

**Why no database manipulation:**
1. Real QA testers do not open pgAdmin before testing — they use the application.
2. Database injection hides bugs in creation flows.
3. Tests that create data through UI are more realistic and test more of the application.
4. A test with SQL seeding bypasses the very flows it should be exercising.

**Exception — integration tests only:** In rare cases where seeding through the UI genuinely does not make sense (database trigger, background job, edge function in isolation), you MAY use INSERT/UPDATE SQL. But you MUST STOP AND ASK THE USER for explicit permission. This exception NEVER applies to e2e, acceptance, smoke, or sanity tests.

### Test Data Discipline

- **Unique identifiers**: Always include timestamps or random suffixes (e.g., `"Test User {{timestamp}}"`)
- **No hardcoded IDs**: Never hardcode database IDs — use dynamic lookups
- **No shared state**: Each test must be independent
- **Dynamic ID lookups in backend blocks**: NEVER hardcode UUIDs. Use subquery lookups from `{profile_user_id}`.

**Bad:** `SELECT count(*) FROM expenses WHERE family_id = 'fc090961-7d40-...'`
**Good:** `SELECT count(*) FROM expenses WHERE family_id = (SELECT family_id FROM family_members WHERE user_id = '{profile_user_id}' LIMIT 1)`

### Multi-Role Tests

Use blocks with different profiles and browser windows:

```
Block 1 (frontend, profile: "admin", window: 1, critical: true):
  Admin creates a new project and invites a team member.

Block 2 (frontend, profile: "team_member", window: 2, critical: true):
  Team member logs in, accepts the invitation, sees the project.

Block 3 (backend, critical: true):
  Verify both users appear in project_members table.
```

### Teardown and Cleanup

Cleanup is the execution agent's responsibility at runtime — not part of the test definition. Tests should use unique, identifiable test data (e.g., names like "Test Expense QA-12345") so cleanup is straightforward.

---

## Review Checklist

Every test MUST be reviewed before it is considered complete. This is the canonical verification checklist — the single source of truth for test quality.

### Review Signature (Server-Enforced)

Tests cannot be executed until reviewed and signed by an INDEPENDENT REVIEWER. The agent that created the test MUST NOT review it.

Lifecycle:
1. `create_test_case` -> unreviewed
2. Independent agent calls `review_test(test_case_id, methodology_key)` -> gets `review_token`
3. Review agent evaluates checklist, calls `sign_test_review(test_case_id, review_token, review_attestation)`
4. `trigger_test_run` -> server checks `review_signature` is not null -> allows execution
5. `modify_test_case` (blocks changed) -> server clears signature -> must re-review

### Prerequisite: Read Source Files First

Before starting the checklist, you MUST read all source code files referenced or implied by the tests. This is blocking — complete all file reads before evaluating any test.

### Verification Checklist (12 Items)

1. **SOURCES CROSS-CHECK** — Every file cited in the artifact appears in `<sources_read>`. Values citing an unlisted file are unverified.

2. **RENDER CHAIN** — Grep for `<ComponentName` in parent JSX. Zero matches = imported but never rendered = test is invalid.

3. **UI STRINGS** — Grep for exact strings in source. Confirm file and line. Unlocatable strings are unverified.

4. **ENUM/STEP VALUES** — Values match source code definitions (read the code, not documentation).

5. **BLOCK STRUCTURE** — Max 7 actions per block. `profile_id` on every frontend block. Critical flags correct. Backend blocks READ-ONLY (SELECT only). Dynamic subquery lookups (no hardcoded UUIDs).

6. **FEATURE EXISTS** — Route handlers, tables, columns all exist. Feature is live, not behind disabled flag.

7. **SELF-SUFFICIENCY** (e2e/acceptance only) — Can this test run on a clean environment? Does it create its own data through UI blocks? If it assumes something exists, there MUST be earlier blocks that create it, or preconditions field explains why.

8. **MINIMUM BLOCK COUNT** (e2e/acceptance only) — 3+ blocks required. 1-block e2e = always a failure. 2-block e2e = suspicious.

9. **UNVERIFIED VALUES** — Any "unverified" in the research artifact = review failure.

10. **USER-OBSERVABLE OUTCOMES** — Every data mutation has a frontend block verifying what the user sees. SQL-only = incomplete for e2e/acceptance. Expected outcomes must be specific (exact text, counts, amounts).

11. **TEST DATA UNIQUENESS** — Test data will not partially match existing system data. Flag well-known real-world values as collision risk.

12. **INPUT FORMAT VERIFICATION** — Test inputs match actual parsing logic (regex, prefix rules). Read the parsing code, do not assume from documentation.

### Coverage Gap Analysis

After reviewing all tests, check for:
- Routes, components, or features with no test coverage
- Error paths not tested (not just happy paths)
- Permission boundaries not tested
- Edge cases not covered (empty states, max values, concurrent access)

Report gaps as additional test suggestions, not failures.

---

## Failure Patterns — Why the Rules Exist

Ordered by frequency. Understanding these helps you avoid them instinctively.

1. **SQL seeding disguised as backend block** — INSERT/UPDATE/DELETE in a backend block. Bypasses creation flows, hides UI bugs.

2. **UI strings drift** — Labels change during development. Always grep for exact strings in source.

3. **Schema assumption** — "amount" vs "total_amount", "user_id" vs "created_by". Always call `supabase_describe_table`.

4. **Placeholder profile IDs** — UUIDs like `00000000-...` do not exist. Always call `get_test_profiles`.

5. **Dead component testing** — File exists but is never rendered. Grep for `<ComponentName` in parent.

6. **Implementation-speak in test steps** — "Click the SaveButton component" is wrong. "Click the 'Save' button" is right.

7. **Hardcoded UUIDs in backend verification** — Every hardcoded UUID will break silently. Use subquery lookups from `{profile_user_id}`.

8. **Step configuration drift** — Multi-step flows have step IDs in code arrays. Documentation ordering may differ.

9. **Feature flag ghosts** — Route exists but is disabled or disconnected from the router.

10. **SQL-only verification** — A test that only checks the database is a unit test disguised as e2e.

11. **Shallow e2e tests** — 1-block e2e tests that are actually smoke checks. Before creating a test, ask "what would a real QA tester check after this action?" They would verify persistence, related UI updates, and backend state.

12. **Non-self-contained regression tests** — Assume pre-existing data. Work on dev machine, fail in CI. Apply the self-sufficiency test to every e2e regression test.

13. **Vague assertions** — "Content is displayed" passes even when the feature is broken. Specify WHAT content.

14. **Test data collision** — Test data partially matches existing system data, causing unexpected behavior. Use obviously unique values.

15. **Interaction format assumptions** — Assuming API/webhook input format without reading the actual parsing code.

---

## Pre-Flight Checklist

Before calling `create_test_case`, confirm:

1. `methodology_key` — from `get_qa_methodology()`. Required. Expires after 2 hours.
2. `suite_id` — from `get_test_suites` or `create_test_suite`
3. `profile_id(s)` — from `get_test_profiles`, one for every frontend block
4. Research artifact completed — all values verified against source code
5. `methodology_attestation` filled out — 6 questions, each with "yes"/"no" AND detailed explanation (30+ chars):
   - `is_self_contained`: Can this test run on a clean environment with nothing except login credentials?
   - `creates_data_via_ui`: Is all data created through the app's UI (no SQL seeding)?
   - `covers_edge_cases`: Does this test go beyond the happy path?
   - `independent_from_other_tests`: Can this test run in any order without depending on other tests?
   - `has_specific_expected_outcomes`: Are expected outcomes exact text/counts, not vague?
   - `has_adequate_block_structure`: Does this test have 3+ blocks (setup, action, verification)?

For e2e/acceptance: "no" on `is_self_contained`, `creates_data_via_ui`, or `has_adequate_block_structure` = hard reject.
