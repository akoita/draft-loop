---
name: start-run
description: Start a DraftLoop CV run for one job application once the candidate confirms its cost, within the agent token's monthly spend cap.
---

# Start a CV run

Use this only when the candidate asks you to start a CV run for one application. A run spends money.

1. Call `list_applications` and find the application by name or id. If several match, ask which one.
2. Call `estimate_run` with its id. Tell the candidate what one run reserves, what remains of the token's monthly cap, and the run's round limit.
3. If `within_cap` is false, stop: say the cap is spent until next month, or the candidate creates a token with a higher limit.
4. Ask the candidate to confirm. Start nothing without a clear yes.
5. Call `start_cv_run` once. Never call it again for the same request, even after an error that looks temporary; tell the candidate instead.
6. Say the run drafts and critiques on its own, and that they approve the draft and decide findings in DraftLoop. To follow it, call `get_run_status` with the run id.

When `start_cv_run` says the requirements are not reviewed, tell the candidate to review the job's requirements in DraftLoop first.

## When a call is refused

A refusal that names the `runs:start` scope means the candidate's agent token lacks it. Tell them to create a token with **Start runs** ticked and a monthly spend limit in DraftLoop's Workspace settings > Agents, then run `draftloop-mcp save-token`.
