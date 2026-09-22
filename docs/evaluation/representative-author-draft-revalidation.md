# Representative author-draft revalidation

**Status:** Indeterminate; no author draft reached validation
**Milestone:** [Representative author-draft revalidation](https://github.com/akoita/draft-loop/milestone/9)
**Observation issue:** #446
**Revision:** `ff8fa1892dc472d9bfe666c44976d260a2a5da60`

This record contains only sanitized, content-free evidence. Candidate material,
the opportunity, the consent record, provider responses, credentials, paths, and
identity remain outside the repository.

## Result

The observation is **indeterminate** under the rules fixed in #446. All three
permitted author attempts ended with a provider error before producing an
artifact, so the corrected local validator never received a draft. No critic
call, first review, approval, or export occurred.

The result says nothing about whether the milestone 8 corrections help a live
author. It shows that the author route itself failed on this revision.

## Admission and bounds

The candidate authorized #446 in their own words: both authentication probes
and one bounded run on the unchanged broader-pilot case A inputs, using the same
models, anonymized public reporting, at most three author attempts and one
critic attempt, and a stop at their first review.

The run declared Anthropic `claude-sonnet-4-5` as author and OpenAI `gpt-5.6-luna`
as critic through authenticated user sessions. Both 20-second authentication
probes passed on the clean revision above. The active provider budget was
1,200,000 milliseconds.

## Attempts

| Attempt | Result | Active provider time | Sanitized diagnostics |
| ------- | ------ | -------------------- | --------------------- |
| 1 | Retryable provider error | 8,836 ms | `claude_terminal_reason_api_error`, `claude_error_subtype_success`, `claude_stop_reason_stop_sequence` |
| 2 | Retryable provider error | 7,935 ms | Same three codes |
| 3 | Final provider error; cap reached | 8,455 ms | Same three codes |

Total active provider time was 25,226 milliseconds, and persisted accounted
duration was 40,250 milliseconds. Every attempt had the `transient` code at the
author step. Provider-reported cost was unavailable.

## Finding

The authentication probe checks only that each CLI is signed in; it does not
call the declared model. Broader-pilot case A's first attempt failed with the
same `api_error` terminal shape. An observation can therefore spend its entire
attempt budget on an author route that cannot answer.

The cause is not diagnosed here, because diagnosis needs a provider call that
issue #446 did not authorize. Issue #449 adds a synthetic, candidate-material-free
model-level preflight that fails closed before a future observation begins.

## Limitations

- One case and one run; no retry was made, because the #446 authorization is
  exhausted.
- No evidence about draft acceptance, factuality, coverage, quality, or
  candidate effort was produced.
- This record does not authorize another provider call, a release, or
  application submission. The stage decision belongs to #447.
