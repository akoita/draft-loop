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

## Economy pair observation

**Issue:** #520 · **Revision:** `2698253` · **CLIs:** Claude Code 2.1.280,
Codex 0.155.1

This record contains only sanitized, content-free evidence. Candidate
material, drafts, and responses remain in the private observation directory.

### Economy pair admission

The candidate authorized #520 with the statement "go". It answered a request
that named the case A material, both providers, and the preflight order. The
pair was `claude-sonnet-4-5` (prompt `cli-author-v3`) as author and
`gpt-6-luna` (prompt `cli-critic-v1`) as critic, through user sessions. The
bounds, stop boundary, and decision rules were the same as #499.

Both probes passed. The synthetic author preflight on `claude-sonnet-4-5`
returned `available` before any candidate material was sent.

### Economy pair attempts

| Attempt | Result | Cumulative provider time | Uncapped diagnostic counts |
| ------- | ------ | ------------------------ | -------------------------- |
| 1 | Retryable local rejection | 161,237 ms | 14 substantive-coverage, 1 missing-evidence, 1 unsupported-claim |
| 2 | Retryable local rejection | 279,850 ms | 8 substantive-coverage, 3 factual-invariant, 3 unsupported-claim |
| 3 | Final local rejection | 405,057 ms | 6 substantive-coverage |

No provider error occurred. The critic was not called, because no draft was
accepted. No review, approval, or export occurred.

### Economy pair result

The observation **fails** under the #499 rules: every permitted author attempt
was rejected by the local validator.

- **The route and models work.** All three attempts returned complete
  structured proposals, with no `api_error`, in about 2 to 3 minutes each.
- **The last attempt had no factual violations.** It failed only on
  substantive coverage.
- **Coverage is the blocker.** A content-free shape analysis of the three
  rejected proposals found the uncovered text in the same places as #476:
  - summary prose between claims, 29 to 52 words per draft;
  - skills lists, 18 to 26 words;
  - short role-header lines with separators (title, employer, dates), where
    only part of the line is claimed.

Changing the author or critic model is unlikely to clear this. The validator
requires every substantive word to be covered verbatim by a claim, and
natural CV prose does not satisfy that. The next step is a product decision
about the coverage rule or about how structured blocks are generated. It
returns to the user.

### Economy pair limitations

- One run of three attempts.
- The diagnostic counts are uncapped, but the per-path lists are capped at
  eight.
