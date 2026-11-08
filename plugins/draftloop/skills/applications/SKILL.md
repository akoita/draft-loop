---
name: applications
description: List the candidate's DraftLoop job applications with each one's status and latest CV run, optionally filtered by folder, status or name.
---

# List my applications

Use this when the candidate asks which job applications they have in DraftLoop, or how they stand overall.

1. Call `list_applications`. Pass `include_archived` only when the candidate asks for archived ones.
2. If the candidate named a folder, a status or part of a name, keep only the matching applications.
3. Show a short table, newest first: name, status, and the latest run's state, or "no run yet".
4. For one application in detail, follow the `status` skill.

Only list what the tool returns. Never guess an application or a run that is not there.

## When a call is refused

A refusal that names the `applications:read` scope means the candidate's agent token lacks it. Tell them to create a token with **Read applications** ticked in DraftLoop's Workspace settings > Agents, then run `draftloop-mcp save-token`.
