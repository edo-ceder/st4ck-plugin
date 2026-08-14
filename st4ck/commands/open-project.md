---
description: Open the st4ck project connected to this folder.
disable-model-invocation: true
allowed-tools: ToolSearch, mcp__st4ck-pm__get_project_briefing
disallowed-tools: Read, Write, Edit, NotebookEdit, Bash, Glob, Grep, WebFetch, WebSearch, Agent, Task, TaskOutput, TaskStop, Skill, AskUserQuestion, TodoWrite, EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree, CronCreate, CronDelete, CronList, ListMcpResourcesTool, ReadMcpResourceTool, mcp__claude_ai_St4ck, mcp__st4ck-dev, mcp__st4ck-qa, mcp__st4ck-ops
---

# Open the connected project

Call `mcp__st4ck-pm__get_project_briefing` exactly once with no arguments.

Do not use a project-listing tool or another st4ck connection. Do not inspect or
change repository files. If the call succeeds, say `Connected to <project
name>.` If the tool is unavailable, tell the user to rerun the connection
command from Add Project.
