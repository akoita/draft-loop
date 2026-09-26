# Author model revalidation

- **Current status:** #551 reached an accepted draft and critic; the candidate gave positive qualitative first-review feedback without exhaustive category counts. Local review found omitted recent roles and employment dates. #548 remains a failed factuality observation.
- **Milestone:** [Reference model pair](https://github.com/akoita/draft-loop/milestone/16)
- **Latest observation:** #551 · 2026-09-26 · revision `40b5e77857df6e2c4ac58000f3d5c6d3e09a2593`
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
review. On 2026-09-26, the candidate found the draft useful while highlighting
the duplicate-content warnings. A subsequent local source check found that the
draft assigned an earlier employer's period to a later employer and omitted the
earlier role. The candidate confirmed the two separate source employment
periods, establishing one factual chronology error in the accepted draft.

The observation **fails** the fixed first-review rule: any factual error,
unsupported claim, or missing required section is enough to fail. One confirmed
factual error suffices; the remaining categories were not exhaustively counted.
Duplication remains a separate quality concern. Critic warnings and the absence
of factual-invariant diagnostics on the rejected attempts do not establish human
factual correctness. Approval remains pending. No product export, submission,
or new run occurred.

### Economy-pair stage decision

A provider-free replay with invented employers reproduced a validator gap:
a fully covered claim or block can combine separately supported date endpoints
into a range that no cited chunk states. The saved artifact's header split its
endpoints into separate claims. The existing complete-range check applied only
to text outside claims. Issue #544 applies that same check to substantive claims
and all block text before further live quality evaluation. It does not prove
that a supported range belongs to a particular employer or enforce complete
credential coverage; those limitations remain.

### Comparison and limitations

Unlike #520, which rejected all three drafts under the earlier coverage rule,
the #526 observation reached an accepted draft after two retries with validation
feedback, followed by one critic call. The offline #522 recheck of #520 used grounded coverage and still
rejected those drafts. These are observations under different rules and
workflows; they do not show that revision feedback caused the different result.
One accepted draft and an independent critique did not establish the fixed
first-review criteria: the candidate-confirmed chronology error defeats the
zero-factual-error requirement.

## Economy-pair recheck after complete-range validation

**Issue:** #548 · **Observed:** 2026-09-26 · **Revision:** `fa3f25ea26cffd331e69f6886bdac8836fecb461`

The candidate authorized one fresh observation with the statement `start`, in
response to the explicit transmission and budget question. The declared pair
was `claude-sonnet-4-5` author and `gpt-6-luna` critic through authenticated user
sessions, using unchanged case A inputs and the complete-range guard from
issue #544 / PR #545. The bounds were three workflow author attempts, one critic
attempt, 1,200,000 ms per request, and 1,200,000 ms total active provider time,
including the synthetic author preflight. Approval, export, submission, and a
second observation were excluded.

| Admission check | Result | Active provider time |
| --- | --- | --- |
| Anthropic user-session sign-in probe | Available and authenticated | No candidate material |
| OpenAI user-session sign-in probe | Available and authenticated | No candidate material |
| Synthetic Sonnet 4.5 author preflight | `api-error` | 8,084 ms |

The failed preflight stopped admission before any candidate transmission.
There were zero workflow author calls, zero critic calls, and no draft,
validator verdict, candidate review, approval, or export. No retry occurred.
The adapter's sanitized `api-error` classification does not identify an HTTP
status or establish the underlying cause.

The observation is **indeterminate** under its fixed admission rule. It does
not test whether the new range guard improves drafting, establish factual
correctness, or change the failed #526 result. The milestone remains active;
any further live observation requires separate authorization.

### Follow-up synthetic diagnosis

The user subsequently requested investigation of a possible credential error.
One separately authorized diagnostic request repeated the same synthetic
preflight on `claude-sonnet-4-5`, with the same adapter defaults and a
60,000 ms timeout. It ran at revision
`f8aaa78`, whose changes from the observation revision were documentation only.
The diagnostic returned `available`, with `errorCode: null` and no diagnostic
codes, in 3,455 ms. The Claude CLI was version 2.1.280. No candidate material
was transmitted and the candidate workflow was not resumed.

The original private runner saved only the preflight status, discarding the
adapter's returned error and diagnostic codes. Consequently the first error's
cause cannot be recovered from that record. The successful repetition makes a
persistent authentication failure less likely, but does not identify the cause
or exclude a transient session problem. It is a separate diagnostic result,
not a successful #548 observation or permission for another candidate run.

### Completed follow-up and local investigation

After the candidate requested investigation, fixes, and completion before
publication, a fresh follow-up workflow ran at revision
`b737853c7168c11feb4f7b58975331862d7659b7`. This revision changed only documents
from the original execution revision. The pair, inputs, and call limits stayed
unchanged. Both sign-in probes passed; the synthetic author preflight succeeded
in 3,068 ms. The private runner was corrected to retain the returned error code
and diagnostic codes, and a missing private rejection-capture parent was
created during the second author request. The first rejected proposal was
therefore not retained; the second was saved for local diagnosis.

| Author call | Revision input | Validator result |
| --- | --- | --- |
| 1 | None | Rejected: 5 factual-invariant violations, 5 uncovered-text issues, 1 missing-evidence issue |
| 2 | Validation feedback | Rejected: 4 uncovered-text issues |
| 3 | Validation feedback | Accepted: 8 sections, 83 claims |

The independent critic completed and reported seven duplicate-content warnings
and nine uncovered-requirement warnings. Provider wall time including preflight
was 530,844 ms; accounted workflow time plus preflight was 559,210 ms, both
within the 1,200,000 ms cap. The local guard blocked post-critic revision before
any fourth author call, leaving the stored run at `provider-error` on revision,
with approval pending. This is the declared stop boundary, not a transport
failure. No approval, export, or submission occurred.

Local source review found that an employment header assigned a career-wide
period to one employer, contradicting the employer-specific period previously
confirmed by the candidate. Its citations supported the employer identity and
the overall period separately. A provider-free replay accepted that same faulty
header before the #550 correction, reproducing the validation gap. The same
private replay then returned one `factual_invariant_violation` with the
correction, without any provider call. The saved
second rejection also contained header text that disagreed with its attached
date claim; the uncovered-text rejection did not need weakening.

This follow-up **fails** the fixed zero-factual-error rule. It does not have a
new exhaustive candidate review or establish the other review categories as
zero. The original transient preflight cause remains unknown; successful
synthetic checks and the completed workflow provide no evidence of a persistent
credential failure. The narrow #550 employer-header association fix is checked
with synthetic examples and a private replay, without another provider call or
a claim that a corrected live draft has been produced.

## Economy-pair observation after employer-header association

**Issue:** #551 · **Observed:** 2026-09-26 · **Revision:** `40b5e77857df6e2c4ac58000f3d5c6d3e09a2593`

The user instructed `merge and continue` after reviewing the completed #548
investigation and the #550 fix. The fresh observation used the same approved
case A inputs and the same authenticated user-session pair: Sonnet 4.5 author
and GPT-6 Luna critic. Both sign-in probes passed and the synthetic author
preflight returned `available` in 4,166 ms. The private setup retained detailed
preflight codes and created the rejection-capture parent before any author call.
The call and time caps remained three author calls, one critic call, and
1,200,000 ms total provider time including preflight.

| Author call | Revision input | Validator result |
| --- | --- | --- |
| 1 | None | Rejected: 4 factual-invariant violations and 5 uncovered-text issues |
| 2 | Validation feedback | Rejected: 2 uncovered-text issues |
| 3 | Validation feedback | Accepted: 8 sections, 68 claims |

The independent critic completed with four duplicate-content and ten
uncovered-requirement warnings. Provider wall time including preflight was
386,824 ms; accounted workflow time plus preflight was 403,825 ms. Both stayed
within the cap. The local guard refused a post-critic author revision before
any fourth author call; the stored state is `provider-error` on revision, with
approval pending. No approval, export, or submission occurred.

### Local investigation before publication

The accepted draft omitted both recent employed roles and most employment
dates. The candidate gave positive qualitative first-review feedback but did
not report exhaustive counts of factual errors, unsupported claims, or missing
required sections. The fixed zero-count pass rule therefore remains unverified;
validator acceptance and critic completion do not establish factual correctness
or completeness. Omitted roles
are a quality problem but are not automatically counted as a missing configured
section when an Experience section exists.

The saved rejected proposals showed that the author received 20 CKB evidence
chunks with no employer-specific dated Markdown headings. This route bypassed
the existing chronology reservation for legacy local sources. A provider-free
replay reproduced the same selection, and bounded local lexical supplements
recovered 13 dated headings from the same approved CKB. Issue #552 adds those
matched headings to application-level CKB selection while retaining the
20-chunk provider cap, required-section supplements, provenance, and traces.
The corrected private runtime replay retained all 13 discovered dated headings
in 20 selected chunks, at 9,888 serialized bytes, with 14 content-free traces;
no provider call was made. The original selection was 34,643 bytes and eight
traces. These counts describe selection, not CV quality or efficiency.
This is a correction to evidence selection, not a relaxation of factual checks
or proof that a subsequent live draft has improved.
