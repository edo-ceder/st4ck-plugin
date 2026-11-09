---
description: Plan or build a major feature as a st4ck build plan.
argument-hint: "<what to build> | <plan_id> <lead|builder|checker>"
---

# Build plan

Arguments: $ARGUMENTS

- If the arguments are a build plan ID and a role (`lead`, `builder` or
  `checker`), call `get_build_brief` on the st4ck dev server with that
  `plan_id` and `role`, then do what it says.
- Otherwise call `get_skill_context` on the st4ck dev server with
  `skill_name` `build-ladder`, then follow it for the feature the arguments
  describe. If they describe none, ask the user what to build.

The rules live in that skill and that brief, not here. If the st4ck dev server
is not connected, say so and stop.
