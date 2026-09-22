# Representative author-draft revalidation

**Status:** First observation indeterminate; retry observation failed
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
  application submission.

## Stage decision

Recorded under #447. The stage exit is met with an indeterminate result: the
observation is recorded against its predeclared rules, but it produced no
evidence about draft acceptance. The rules were not changed after the result.

The indeterminate rule applies, so the next stage is
[author route readiness](https://github.com/akoita/draft-loop/milestone/10),
not a cohort or further replay work. It requires #449's synthetic model-level
preflight, followed by one separately authorized synthetic run on the declared
author model. A new consented observation may be proposed only after that
preflight reports `available` or the blocker is resolved.

## Follow-up author preflight

Under a separate user authorization naming #449, the synthetic model-level
preflight ran once on `bd3bc5a` against `claude-sonnet-4-5`. It returned
`available` in 5,222 ms, with no error code or diagnostics. The request carried
no candidate material and used the application author output budget, so the
second authorized model check was not needed.

The declared model and author settings therefore work. The #446 failures
belong to the real author request, and #453 makes their cause visible before
another observation.

## Retry observation

**Issue:** #456 · **Revision:** `d116b2e76d9103926692d5baa3cb630687c9e003`

The candidate authorized #456 in their own words: both sign-in probes, one
synthetic author preflight, and one bounded run on the unchanged case A
material, with the same models, bounds, and first-review boundary as #446.
Both probes passed, and the synthetic author preflight on `claude-sonnet-4-5`
returned `available` before any candidate material was sent.

| Attempt | Result | Active provider time | Sanitized diagnostics (at most eight kept) |
| ------- | ------ | -------------------- | ------------------------------------------ |
| 1 | Retryable provider error | 479,236 ms | `claude_terminal_reason_api_error`, `claude_error_subtype_success`, `claude_stop_reason_stop_sequence`; no `claude_api_error_*` cause code |
| 2 | Retryable local rejection | 228,605 ms | Two factual-invariant and six substantive-coverage diagnostics |
| 3 | Final local rejection | 233,020 ms | Four unsupported-claim, two factual-invariant, and two substantive-coverage diagnostics |

Total active provider time was 940,861 milliseconds, and persisted accounted
duration was 952,332 milliseconds. No critic call, first review, approval, or
export occurred. Provider-reported cost was unavailable.

### Retry result

The retry observation **fails** under the rules fixed in #456. The validator
returned a verdict on both attempts that produced a draft and rejected each.
The provider error on attempt 1 consumed one attempt but did not leave the run
without a validator verdict, so the indeterminate rule does not apply. The
rules were not changed after the result.

### Findings

- **The milestone 8 corrections did not produce an accepted draft on this
  case.** With structured retry feedback, attempt 3 still failed, and its
  rejection added unsupported-claim diagnostics that attempt 2 did not have.
- **Diagnostic counts are lower bounds.** The orchestrator keeps at most eight
  diagnostics per attempt. The case A counts under #430 were capped the same
  way, so the two runs cannot be compared exactly.
- **The author `api_error` persists and differs from #446.** It arrived after
  about eight minutes rather than eight seconds, and the result text contained
  none of the allowlisted cause tokens. Two of the four author requests on this
  case now fail this way.

## Retry stage decision

Recorded under #456. The fail rule applies, so the next stage is provider-free
replay work seeded by these failure classes, not a cohort. The stage should
start by recording the full content-free diagnostic counts per family, so later
comparisons are not hidden by the eight-item cap. The unexplained `api_error`
remains an open risk for any later observation.
