# Author model revalidation

- **Current status:** #526 produced an accepted draft and independent critique; the candidate's first review is pending.
- **Milestone:** [Reference model pair](https://github.com/akoita/draft-loop/milestone/16)
- **Latest observation:** #526 · 2026-09-24 · revision `1d5c3a8cfd2d521dd79aed4c4fa201da398835b0`
- **Historical observation:** #499 was indeterminate; `claude-sonnet-5` produced no draft.

This record contains only sanitized, content-free evidence.

## Author model revalidation (#499)

**Status:** Indeterminate; no draft produced with `claude-sonnet-5`

**Revision:** `336bb30`

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

### Offline recheck under the grounded coverage rule

Under #522, uncovered block text is rejected only when it introduces an
unsupported word, protected value, date range, or name. The three #520 captures
were revalidated locally, with no provider calls. Only content-free counts were
printed.

| Draft | Coverage issues before | Coverage issues after | Other issues | Result |
| ----- | ---------------------- | --------------------- | ------------ | ------ |
| 1 | 14 | 7 | 2 | rejected |
| 2 | 8 | 4 | 6 | rejected |
| 3 | 6 | 6 | 0 | rejected |

- **Accepted now:** 13 uncovered blocks, whose wording came only from evidence
  and function words.
- **Still rejected: date ranges.** 18 blocks remain. Most are role headers
  whose date range is not stated in the evidence, which writes "January 2019
  to March 2022" style ranges. Comparing each draft range with the 40 ranges
  in the source:
  - some drafts merge real start and end dates across positions;
  - every draft also has two or three ranges with a start or end date that
    appears nowhere in the source file. Those are errors, and the validator is
    right to reject them.
- **Still rejected: words.** 28 uncovered content words appear in no retrieved
  chunk. Ten are elsewhere in the source file, four appear only in the job
  description (draft 2's summary), and fourteen appear in neither.

The grounded rule removes rejections of honest wording. It does not accept
these drafts, because `claude-sonnet-4-5` stated employment dates that the
evidence does not support.

## Economy pair with author revision feedback

**Issue:** #526 · **Observed:** 2026-09-24 · **Revision:** `1d5c3a8cfd2d521dd79aed4c4fa201da398835b0`

The run recorded authorization as `authorized` on 2026-09-24. Both user-session
authentication probes passed, and the synthetic author preflight returned
`available`. The pair was `claude-sonnet-4-5` (`cli-author-v3`) as author and
`gpt-6-luna` (`cli-critic-v1`) as critic. The bounds were three author calls,
one critic call, 1,200,000 ms per request, and 1,200,000 ms total active
provider time.

| Author call | Revision input | Result | Cumulative provider wall time |
| ----------- | -------------- | ------ | ----------------------------- |
| 1 | None | Rejected with 8 `substantive_text_uncovered` issues | 162,760 ms |
| 2 | Validation feedback | Rejected with 1 `substantive_text_uncovered` issue | 308,141 ms |
| 3 | Validation feedback | Accepted; 8 sections and 95 claims | 481,729 ms |

The critic completed one call. It reported 13 `duplicate-content`, 7
`uncovered-requirement`, and one each of `production-scope-overstatement`,
`event-sourcing-gap-omitted`, and `certification-scope`, all as warnings. Total
cumulative provider wall time after the critic was 500,433 ms; persisted
accounted active duration was 555,111 ms.

After the critic, the runner's local stop guard refused a post-critic author
revision before any fourth provider call. The persisted state is `provider-error`
at revision (`unknown`, nonretryable, round 2). This records the local stop
boundary, not a provider transport failure.

The accepted draft and critic findings were rendered privately for candidate
review. The fixed first-review criteria are zero factual errors, unsupported
claims, and missing required sections. That review is pending, so this
observation has no pass/fail decision. Critic warnings are not the candidate's
decision. The rejected attempts had no factual-invariant or unsupported-claim
diagnostics; that does not establish human factual correctness. Approval remains
pending. No product export, submission, or new run occurred.

On 2026-09-26, the candidate gave a positive first impression of the draft and
found its content useful, while highlighting the duplicate-content warnings.
Confirmation of the three fixed first-review counts is still pending;
duplication remains a quality concern even if the factuality and completeness
criteria pass.

### Comparison and limitations

Unlike #520, which rejected all three drafts under the earlier coverage rule,
the #526 observation reached an accepted draft after two retries with validation
feedback, followed by one critic call. The offline #522 recheck of #520 used grounded coverage and still
rejected those drafts. These are observations under different rules and
workflows; they do not show that revision feedback caused the different result.
One accepted draft and an independent critique do not establish the fixed
first-review criteria, and the candidate review remains pending.
