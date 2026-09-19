# Broader real-application pilot

**Status:** Case A indeterminate; declared cohort cannot pass
**Milestone:** [Broader real-application pilot](https://github.com/akoita/draft-loop/milestone/7)
**Case issue:** #430
**Revision:** `5f5071d9ea66757c5a3674883092f2c189b35fe8`

This record contains only sanitized, content-free evidence. Candidate material,
the opportunity, manual baseline, private thresholds, declaration timestamps,
provider responses, credentials, paths, and identity remain outside the
repository.

## Admission and boundaries

The candidate authorized issue #430, both user-session authentication probes,
one bounded provider workflow, reuse of the existing private matched-backend
case and candidate-authored manual baseline, and anonymized public reporting.
The private cohort declaration fixed a minimum of three cases before the first
new draft. The per-case gate, provider identities, retention choice, budget,
and stop conditions were also fixed before execution.

The run used Anthropic `claude-sonnet-4-5` as author and OpenAI
`gpt-5.6-luna` as critic through authenticated user sessions. The manual
baseline was withheld from generation. The workflow allowed one fresh run, at
most three author attempts, at most one critic attempt, three rounds, and
1,200,000 milliseconds of active provider time. Both 20-second authentication
probes passed on the exact clean revision above.

## Case A result

The workflow stopped during authoring after exhausting its three-attempt cap:

| Attempt | Result | Sanitized evidence |
| ------- | ------ | ------------------ |
| 1 | Retryable provider error | Structured terminal category `api_error`; no artifact |
| 2 | Retryable local rejection | Two factual-invariant and six substantive-coverage diagnostics |
| 3 | Final local rejection | One factual-invariant, one unsupported-claim, and six substantive-coverage diagnostics |

Total active provider time was 1,009,355 milliseconds; persisted accounted
duration was 1,030,002 milliseconds. Provider-reported cost was unavailable.
No accepted first draft, revised draft, critic call, findings, human review,
approval, or export exists.

## Decision

Case A is indeterminate and fails the admission outcome required for a counted
cohort case. Factual non-regression, quality improvement, effort reduction,
professional readiness, and the two adversarial observations cannot be
evaluated without an accepted draft. The predeclared cohort requires every
case gate to pass, so this result makes a passing three-case cohort impossible.

The issue #430 authorization is exhausted. This record does not authorize a
retry, cases B or C, another provider call, a release, or application
submission.
