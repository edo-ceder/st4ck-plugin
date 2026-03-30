---
description: Run a supervisor check on the current session — catches drift, incomplete work, and premature completion claims.
argument-hint:
---

# /supervise

A supervisor has analyzed this session's transcript and injected its findings above this message. The supervisor extracted the conversation, identified the evolving user intent, and compared it against your recent actions.

## What You Must Do Now

1. **Read the supervisor's assessment** (injected above by the UserPromptSubmit hook)
2. **Answer every question** the supervisor asked — honestly. If you skipped something, say so.
3. **Address every gap** identified:
   - If the assessment is **NUDGE** — fix the gaps before doing anything else
   - If the assessment is **STOP** — present the situation to the user and wait for their decision
   - If the assessment is **CLEAR** — acknowledge and continue your work
4. **Do NOT dismiss the supervisor's findings.** If you disagree with a finding, explain why with evidence — don't just say "I already did that."

## Rules

- The supervisor's assessment takes priority over your current plan if they conflict
- If the supervisor found you claimed "done" but items are missing — go back and finish them
- If the supervisor found data was modified during testing — STOP and tell the user immediately
- If the supervisor asks "is there anything you skipped?" — answer truthfully. The supervisor will verify your answer on the next cycle.

## If No Supervisor Output Appears Above

The extraction hook may not have fired. This can happen if:
- The plugin's hooks aren't loaded (restart Claude Code)
- The transcript path wasn't available

In this case, perform a self-check:
1. What was the user's most recent instruction?
2. Did you fully complete it, or did you stop partway?
3. Are there items you marked as "done" without verifying?
4. Did you modify any data you shouldn't have?

Report honestly to the user.
