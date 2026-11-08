---
name: status
description: Say where one DraftLoop job application and its CV run stand, and what the candidate does next in DraftLoop.
---

# Application status

Use this when the candidate asks about one application, by name or id.

1. Call `list_applications` and find the application by name or id. If several match, ask which one.
2. Call `get_application` for it.
3. If it has a latest run, call `get_run_status` with that run's id.
4. Tell the candidate its status, the run's state and round, and how many findings wait. Repeat `next_step` in your own words.
5. Call `get_job_text` only if the candidate asks about the job itself, and quote it rather than summarising it.

Approving the draft, deciding findings and exporting are the candidate's, in DraftLoop.

## When a call is refused

A refusal that names the `applications:read` scope means the candidate's agent token lacks it. Tell them to create a token with **Read applications** ticked in DraftLoop's Workspace settings > Agents, then run `draftloop-mcp save-token`.
