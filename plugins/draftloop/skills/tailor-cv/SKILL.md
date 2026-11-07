---
name: tailor-cv
description: Add a job the candidate pasted to DraftLoop and follow its CV run, leaving every decision to the candidate in DraftLoop.
---

# Tailor a CV to a job

Use this when the candidate gives you a job description and wants a CV for it, or asks how an application's CV run stands.

## Add the job

1. Ask the candidate to paste the job description if they have not. Take only text they gave you; never fetch a job page, and never invent or summarise requirements.
2. Call `list_applications` and check that the job is not already there, by name.
3. Call `add_job` with a short name, such as the role and employer, and the job text exactly as given.
4. Tell the candidate the application is in DraftLoop, and that they extract its requirements, review them and start the CV run there.

## Follow a run

1. Call `get_application` for the application, or `list_applications` to find it.
2. Call `get_run_status` with its latest run's id.
3. Repeat `next_step` to the candidate in your own words. Approving the draft, deciding findings and exporting are theirs, in DraftLoop.

## When a call is refused

A refusal that names a scope, such as `applications:read` or `jobs:write`, means the candidate's agent token lacks it. Tell them to create a token with it under **Coding agents** in DraftLoop's Workspace settings, then run `draftloop-mcp save-token`.
