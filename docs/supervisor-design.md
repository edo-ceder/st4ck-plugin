# Design: Supervisor Command & Hook

**Date**: 2026-03-30
**Status**: Draft — awaiting review

---

## Problem

Agents have a completion bias. They declare "done" when not done, skip blocks, fabricate limitations, contaminate data, and drift from user instructions as context grows. The user ends up being the supervisor — catching gaps, pushing the agent forward, reminding it of earlier decisions. This is the job a machine should do.

The supervisor is NOT a checklist. It's a context-aware manager that reads the evolving conversation, understands what the user actually wants NOW (not just what they asked initially), and compares that against what the agent is actually doing.

---

## Core Principles (Project-Agnostic)

The supervisor enforces 6 general project agnostic principles. These are not stack-specific — they apply whether the project uses Supabase, Bubble, Rails, or anything else.

| # | Principle | What it catches |
|---|-----------|----------------|
| 1 | **What you claimed — verify it** | Agent says "done/passing/deployed" without evidence |
| 2 | **What you don't know — learn before acting** | Agent writes tests without exploring the UI, assumes app state |
| 3 | **What you were told — are you still doing it?** | Agent drifts from user instructions given several messages ago |
| 4 | **What you changed — did you break anything?** | Agent fixes one thing, breaks another, doesn't re-check |
| 5 | **What's blocking you — solve it, don't skip it** | Agent declares "can't" instead of creating preconditions |
| 6 | **Read-only unless explicitly told otherwise** | Agent modifies production/test data when it should only be observing |

---

## Architecture

### Two Components (Phase 1)

```
┌─────────────────────────────────────────────────┐
│ 1. /supervise command (manual trigger)          │
│    User runs it when they want a checkpoint     │
│    UserPromptSubmit hook extracts transcript     │
│    claude -p analyzes, outputs nudge to stdout   │
│    Nudge injected as context, command instructs  │
│    agent to follow it                            │
├─────────────────────────────────────────────────┤
│ 2. Back-and-forth via repeated invocation        │
│    Phase 1: user runs /supervise again to cycle  │
│    Phase 2: Stop hook cycles automatically       │
│    Each cycle reads the NEW transcript including │
│    agent's response to the previous nudge        │
└─────────────────────────────────────────────────┘
```

### How Back-and-Forth Works

The Stop hook pattern IS a conversation (same as ralph-loop):
1. Agent tries to stop → hook reads transcript → blocks with nudge
2. Agent responds to nudge → tries to stop again → hook reads NEW transcript (including response)
3. Hook evaluates: did the agent address the gap? If yes → let it stop. If no → nudge again.
4. Escalation counter: 2 consecutive nudges for the same gap with no progress → STOP, escalate to user.

In Phase 1 (manual), the user triggers each cycle by running `/supervise` again.
In Phase 2 (automated), the Stop hook triggers each cycle automatically.

### Phase 2: Automated Stop Hook (after Phase 1 is proven)

Same supervisor logic, triggered automatically when agent tries to stop. Uses the same state file, session-isolated.

- Lives in plugin's `hooks/hooks.json` (plugin hooks DO work — ralph-loop proves this)
- Red button: create `.st4ck/supervisor-off` to kill the loop
- Escalation counter: 2 repeated nudges for same gap → force stop, present to user
- Model: inherits session model (not hardcoded to Sonnet or Haiku)

---

## Supervisor Agent: How It Thinks

### Step 1: Reconstruct User Intent

The user's intent EVOLVES. Requests drift. The supervisor reads ALL user messages (not just the first) and builds a living summary:

```
What the user originally asked:
  [First user message — the initial goal]

How it evolved:
  [Message N: user redirected to focus on X]
  [Message M: user said "don't do Y, focus on Z"]
  [Message P: user gave a decision — "option B, not A"]

Current state of user intent:
  [What the user wants RIGHT NOW, synthesized from all inputs]

Key decisions made along the way:
  [Decision 1: user chose approach X over Y]
  [Decision 2: user said "never modify data"]
  [Decision 3: user said "test ONE first, then all"]
```

This summary becomes the "refresh" injected back into the orchestrator's context — reminding it of decisions and instructions it may have lost to context pressure.

### Step 2: Read Agent's Reasoning

If the agent used extended thinking AND thinking blocks appear in the transcript JSONL (this needs empirical verification — they may be stripped), read them. The supervisor must RESPOND to the agent's train of thought, not just its output. This reveals:

- What the agent THOUGHT it was doing vs what it actually did
- Whether it considered and dismissed a concern ("I could check the console but the UI looks fine")
- Whether it's aware of gaps but chose to skip them
- Whether it's rationalizing a shortcut ("this is close enough")

**Fallback (if thinking blocks are not in transcript)**: Read the agent's last several text outputs to understand its stated position. On the next cycle (back-and-forth), the supervisor includes reflection questions in the nudge — the agent's responses reveal its reasoning even without `<thinking>` access.

### Step 3: Compare Intent vs Reality

For each item in the user's current intent, compare against what the agent actually did:

```
Intent: "Run all 42 tests"
Reality: Agent ran 4, declared "continuing" but stopped
Gap: 38 tests not run
Nudge: "You ran 4 of 42 tests. Continue with the remaining 38."
```

### Step 4: Review Agent Results Against What It Knows

Don't just check if the agent CLAIMS it's done — check if its results match its own knowledge:

1. **Count check**: If tasks/tests/blocks were mentioned, does the count match?
   - "42 tests" → how many actually reported?
   - "4 blocks" per test → how many in the report?

2. **Evidence check**: For each "pass" claim, is there evidence?
   - Screenshots? Console output? Test IDs?
   - Or just "it works" with no proof?

3. **Regression check**: After fixes, were earlier items re-tested?
   - If centralized code was changed, were all suites re-run?

4. **Direct questioning via back-and-forth**: The nudge includes reflection questions for the agent. On the next cycle, the supervisor reads the agent's answers in the updated transcript. This creates a real conversation:
   - Cycle 1 nudge: "Is there anything you skipped, deferred, or marked as 'not applicable'?"
   - Agent responds honestly (the "to be honest" pattern)
   - Cycle 2: supervisor reads the response and evaluates whether the gaps are real
   - If the agent confessed to skipping something → nudge it to go back and do it
   - If the agent says "nothing skipped" but the count doesn't match → escalate

### Step 5: Check Data Safety

Compare data modifications against what is warranted:

- Read the skills/instructions given to the agent — did any skill say "don't modify data"?
- Did the user explicitly approve data modification at any point?
- Is the agent in a phase where data modification is expected (e.g., implementation) vs unexpected (e.g., testing)?
- Was the modification required by the task (R&D, seeding test data through UI)?

**Decision matrix:**
```
User approved modification       → OK, note it
Skill says "don't modify data"   → STOP — flag to user
No skill mentions it, but agent
  is in testing phase            → STOP — flag to user
Agent is implementing code and
  needs to seed data             → OK if through UI, STOP if direct DB
```

If data was modified and it's not clearly warranted: **STOP — flag to user.** The supervisor cannot determine if cleanup is needed.

### Step 6: Decide — Nudge or Stop

```
if gaps exist AND they're addressable by the agent:
    → NUDGE: inject gap summary + instructions as user message
    → Include refreshed user intent summary
    → Include relevant skill instructions the agent may have forgotten
    → Include specific next actions

if gaps exist AND they need human judgment:
    → STOP: present gaps to user
    → Examples: data was modified unexpectedly, scope changed,
      agent needs a decision, agent is genuinely stuck

if agent is genuinely stuck (not lazy):
    → STOP: agent needs user input
    → Signs of genuine stuck: needs API key, needs access it doesn't have,
      needs a product decision, external dependency is down
    → Signs of lazy stuck: says "can't" but has the tools, declares
      "limitation" without investigating, skips a block and moves on

if no gaps:
    → CLEAR: "Supervisor check passed. Agent appears on track."
```

**Distinguishing "lazy stuck" from "genuinely stuck"** — this is the whole point:
- **Lazy stuck**: Agent says "can't do X" → supervisor checks: does the agent have tools/access for X? If yes → nudge: "You have [tool]. Use it."
- **Genuine stuck**: Agent says "need API key for service Y" → supervisor checks: is there a key in env/config? If no → STOP: user needs to provide it.
- **Evasion**: Agent says "done" but didn't finish → supervisor counts items, compares to request → nudge with the gap.
- **Drift**: Agent is doing something the user didn't ask for → supervisor compares current work to latest user intent → nudge: "User asked for X, you're doing Y."

---

## What Gets Injected Back (The Nudge)

When the supervisor finds gaps, it produces a message injected as a **user message** (highest authority):

```markdown
## Supervisor Check — Gaps Found

### Session Context Refresh
[Summary of user intent evolution + key decisions — this is the memory refresh]

### Gaps
1. [Specific gap with evidence]
2. [Specific gap with evidence]

### Required Actions
1. [Specific action to take]
2. [Specific action to take]

### Reminders (from earlier in this session)
- [Instruction the agent may have forgotten]
- [Decision that was made and may have drifted]
- [Skill instruction that applies but wasn't followed]

### Data Safety
- [Any data modification concerns, or "No concerns"]
```

---

## What Goes Into Skills (Not Supervisor)

Some rules belong in the QA authoring/running skills. The supervisor CHECKS these were followed, but the skill TEACHES them.

### For qa-author agent:
1. **Before writing tests, explore the UI** via agent-browser (preferred) or Playwright MCP (fallback). Navigate the app, note actual button labels, sidebar states, form fields. Don't guess from code alone. For no-code platforms (Bubble, etc.) this is the ONLY way to learn the UI — codebase grep is useless.
2. **Test source priority**: requirements/specs (if in context) → plan (if exists) → code + running app. Don't read PRD/specs unless the user provides them or they're already in context. Default to code.
3. **Every test must create its own preconditions.** Never assume app state. Block 0/1 should set up whatever the test needs.
4. **Be explicit in block instructions.** List actual button text, expected sidebar items, specific URLs. Don't write "the action button" — write the button's actual label.
5. **Test ONE first, verify it works with a sub-agent, then apply the pattern to remaining tests.** Don't batch-author 42 tests based on an unverified pattern.
6. **NEVER modify production or test data directly.** Tests must use the UI to create preconditions (signup flow, form submissions). If data modification is unavoidable, STOP and ask the user.

### For qa-runner agent:
7. **You are the sub-agent. You must understand the test from the test case alone.** Fetch the test, read the blocks, execute them. Don't expect the orchestrator to hand-translate blocks.
8. **When a precondition fails, report it as a test_bug (broken SEED), not as BLOCKED.** Suggest how to fix the SEED step.
9. **Console evidence is mandatory for every block.** Not just failed blocks.
10. **NEVER modify data during test execution.** If the test requires data that doesn't exist, report it as a test setup gap. DO NOT create data via API/DB. If you truly cannot proceed without data modification, STOP and ask the user.

---

## Transcript Access

Follow the memory-layer pattern (session-memory plugin):

1. **Extract conversation from JSONL transcript** using Python — filter to user/assistant text blocks, skip tool calls/system reminders, truncate long blocks
2. **Cap at ~60K chars** (last portion = most recent conversation)
3. **Incremental**: if a previous supervisor state exists, feed it as context so the summary builds on previous checks rather than starting from scratch. This is how intent survives the 60K window — earlier checks captured decisions that are now outside the window.
4. **Use `claude -p`** for the transcript analysis (inherits session model — no hardcoded model). The supervisor's judgment calls (lazy vs genuine, drift detection) need the same reasoning quality as the main agent.

The manual `/supervise` command uses the same extraction pipeline as memory-layer's extract.sh — but the prompt is different (supervisor check, not memory extraction).

### Single Command (No Depth Variants)

One command: `/supervise`. It reads the transcript, runs the supervisor agent, injects the result. We evaluate this command and use it as the basis for the automated Stop hook in Phase 2.

---

## Session Isolation

### State File
```
.st4ck/supervisor-state-{SESSION_ID}.json
{
  "session_id": "abc123",
  "created_at": "2026-03-30T...",
  "last_check_at": "2026-03-30T...",
  "check_count": 3,
  "user_intent_summary": "...",
  "key_decisions": [...],
  "gaps_found_history": [...],
  "nudges_given": [...],
  "nudge_outcomes": [...],
  "escalation_counter": {
    "gap_id": { "nudge_count": 2, "resolved": false }
  }
}
```

### Escalation Counter (Phase 2)
If the same gap appears in 2 consecutive nudges without progress:
- STOP the loop — do not nudge again
- Present the situation to the user: "Nudged twice about [gap], agent did not resolve. Needs your intervention."
- Track via `escalation_counter` in state file

### Nudge Outcome Tracking
After each nudge, the next supervisor check compares "what was nudged" vs "what agent did":
- If the agent addressed the gap → record as resolved
- If the agent ignored the nudge → increment escalation counter
- This data informs Phase 2 automation and calibrates nudge quality
```

### Why Session-Specific (from day 1)
The ralph-loop lesson: its state file is project-scoped, not session-scoped. If two sessions run in the same project, the Stop hook fires for BOTH sessions but only one owns the loop. Ralph added `session_id` to fix this, but it was an afterthought.

Our design:
- State file includes `$CLAUDE_CODE_SESSION_ID` in the filename
- Stop hook (Phase 2) checks `session_id` in the hook input against the state file
- If they don't match, the hook exits silently (doesn't interfere)

### Red Button (Phase 2)
Create `.st4ck/supervisor-off` to disable the automated hook globally.
The manual `/supervise` command always works regardless of this file.

---

## Implementation Sequence

### Phase 1: Manual Command + Agent (this PR)
1. `agents/supervisor.md` — the supervisor agent definition
2. `commands/supervise.md` — the manual trigger command
3. `hooks/supervisor-extract.sh` — transcript extraction script (adapted from memory-layer)
4. Update `qa-author.md` — add UI exploration + precondition + "stick to code" rules
5. Update `qa-runner.md` — add independence + data safety rules
6. Update `README.md` — document the supervisor

### Phase 2: Automated Stop Hook (separate PR, after testing)
1. `hooks/supervisor-stop.sh` — the Stop hook script (our ralph-loop equivalent)
2. `hooks/hooks.json` — hook configuration in plugin (plugin hooks work — ralph-loop proves this)
3. Red button: `.st4ck/supervisor-off` file + `/supervise off` command
4. Escalation counter: 2 repeated nudges → force stop
5. Handles: "is this genuinely stuck or lazy?" decision

### Phase 3: Refinement (based on real usage)
- Tune: transcript window size, nudge aggressiveness
- Add: pattern detection for specific evasion tactics
- Add: integration with `.st4ck/implement-state.json` for structured task tracking
- Add: skill-awareness (supervisor reads which skills were loaded and checks compliance)
