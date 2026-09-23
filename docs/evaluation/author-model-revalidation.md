# Author model revalidation

**Status:** Indeterminate; no draft produced with `claude-sonnet-5`
**Milestone:** [Author model revalidation](https://github.com/akoita/draft-loop/milestone/16)
**Observation issue:** #499
**Revision:** `336bb30`

This record contains only sanitized, content-free evidence.

## Admission and setup

The candidate authorized #499 in their own words:

- both sign-in probes;
- one synthetic author preflight on `claude-sonnet-5`;
- one bounded run on the unchanged case A material, with `claude-sonnet-5` as author and local capture of rejected proposals, stopping at their first review.

Both probes passed, and the preflight on `claude-sonnet-5` returned
`available`. The prepared run recorded:

- author `claude-sonnet-5` (Anthropic) with prompt `cli-author-v3`;
- critic `gpt-5.6-luna` (OpenAI) with prompt `cli-critic-v1`.

The author model was the only change from #496.

## Attempts

| Attempt | Result | Active provider time | Sanitized diagnostics |
| ------- | ------ | -------------------- | --------------------- |
| 1 | Retryable provider error (`transient`) | 656,502 ms | `claude_terminal_reason_api_error`, `claude_error_subtype_success`, `claude_stop_reason_stop_sequence`; no `claude_api_error_*` cause code |
| 2 | Retryable provider error (`timeout`) | 519,685 ms | None; the request used the remaining active provider budget |

Total active provider time was 1,176,187 milliseconds. Accounted duration was
1,214,893 milliseconds, which exceeds the 1,200,000 ms budget, so no third
attempt was made. No draft or capture exists, and no critic call, first
review, approval, or export occurred.

## Result

The observation is **indeterminate** under the rules fixed in #499: provider
errors and the budget left no validator verdict. The model effect cannot be
measured without drafts.

## Stage decision

The indeterminate rule applies, so the route decision returns to the user.

`claude-sonnet-5` generated much more slowly on the real author request than
`claude-sonnet-4-5` did: one attempt used 656 seconds before failing. The
status-less `api_error` also appeared again, now after about eleven minutes.
It has occurred after about 8 seconds (#446), about 8 minutes (#456), and
about 11 minutes (#499), and in one synthetic preflight (#489). It remains
unexplained and appears to be tied to the route rather than to a model or
prompt.

Options for the user decision, none of which is authorized here:

- **Larger time budget.** Repeat with a larger active-provider-time budget,
  so a slower model can finish, for example 2,400,000 ms.
- **Diagnose the route first.** Investigate the recurring `api_error` with
  synthetic long-generation requests before another observation.
- **Deterministic structured blocks.** Generate heading, contact, and skills
  blocks from evidence fields, which reduces how much the author must produce.

## Limitations

- One run. Two attempts, both without a validator verdict.
