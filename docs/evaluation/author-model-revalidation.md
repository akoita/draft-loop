# Author model revalidation

- **Current status:** The candidate accepts the manually revised full-profile draft with two acknowledged warnings. It has no deterministic or independent critic errors. This establishes acceptance of the revised draft, not an automated first-draft reference pass; full-profile product integration remains pending.
- **Milestone:** [Reference model pair](https://github.com/akoita/draft-loop/milestone/16)
- **Latest observation:** manual presentation revision · 2026-09-27 (Europe/Paris) · review revision `e37fd067cb75d87d600ef1d8a246dbc5f8806d64`
- **Historical observation:** #499 was indeterminate; `claude-sonnet-5` produced no draft.

This record contains only sanitized, content-free evidence.

## Acceptance rule for future observations

The candidate clarified the product goal after accepting the manual revision:
zero findings is ideal, but the stopping condition is a draft whose remaining
findings are acceptable to the user in number, severity, and substance. Each
finding remains visible with the user's decision and rationale. Accepted
limitations do not require another revision or another provider call merely to
reduce the finding count. Acknowledged findings are not silently relabelled as
resolved, and accepting quality does not authorize export or publication.

Future evaluation admissions must use this user-acceptance rule rather than
require exhaustive zero counts. Deterministic integrity and grounding checks
remain in force. Historical observations retain their original admissions and
results; this clarification does not retrospectively turn a failed observation
into a pass. Manual acceptance also does not establish an automated outcome.

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
or completeness. Omitted roles are a quality problem but are not automatically counted as a missing configured
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

## Economy-pair verification of chronology selection (#554)

**Observed:** 2026-09-26 · **Revision:** `57c5fa2ee03b9233faf859cd64eb77fe2937aa5a`

The user instructed `continue` after PR #553 merged. This observation reused
case A and the Sonnet 4.5/GPT-6 Luna user-session pair under the same three-author,
one-critic, 1,200,000 ms limits. Both authentication probes passed; the synthetic
author preflight succeeded in 3,027 ms. The captured author input contained
20 selected chunks, including 13 dated heading chunks. This verifies the
chronology-selection correction in a live request, not the resulting CV quality.

| Author call | Result |
| --- | --- |
| 1 | Rejected: one missing citation and two uncovered-text blocks |
| 2 | Rejected: two uncovered-text blocks |
| 3 | Claude exhausted structured-output retries; no proposal reached validation |

The final request reported `claude_error_subtype_error_max_structured_output_retries`
and `claude_terminal_reason_structured_output_retry_exhausted`, with
`claude_stop_reason_unavailable`. No authentication-error evidence was reported.
Provider wall time including preflight was 246,616 ms; accounted workflow time
plus preflight was 270,214 ms. There was no accepted draft or critic call, and
no candidate first review, approval, export, or submission.

The result is **indeterminate** under the predeclared rule: the final permitted
request ended in a provider error without a validator verdict. Both earlier
rejected proposals remain rejected. Offline replay reproduced their diagnostics.
A controlled edit to the second proposal's contact and summary blocks, removing
uncited content and limiting prose to its cited assertions, passed the unchanged
validator. That diagnostic edit is not a corrected live draft or an evaluation
pass. Existing provider tests already cover the observed retry-exhaustion
classification; the investigation established no new validator or credential
defect.

## Standard frontier pair after chronology selection (#555)

**Observed:** 2026-09-26 · **Revision:** `57c5fa2ee03b9233faf859cd64eb77fe2937aa5a`

The user explicitly approved #555 after reviewing its fixed design: the same
private case A, `claude-opus-5-5` author and `gpt-6-sol` critic through authenticated
user sessions, at most three author attempts and one critic call, and 1,200,000 ms
including preflight. This authorized the standard frontier observation without
API-key billing, model substitution, or a default change. Both authentication
probes passed, and the synthetic author preflight succeeded in 2,537 ms.

| Author call | Revision input | Validator result |
| --- | --- | --- |
| 1 | None | Rejected: one factual-invariant violation and one uncovered-text block |
| 2 | Validation feedback | Accepted: 7 sections, 61 claims |

The GPT-6 Sol critique completed with two errors: missing core job-relevant
evidence and omission of the candidate-requested experience-gap statement.
There were eight duplicate-content and sixteen deterministic uncovered-requirement
warnings, plus three content warnings about project contributions, training
classification, and skills selection. Critic findings do not substitute for
candidate adjudication under the fixed first-review rule.

Provider wall time including preflight was 140,913 ms; accounted workflow time
plus preflight was 174,019 ms. The workflow stopped in `awaiting-approval`, with
approval pending and no further author call. No approval, export, or submission
occurred. The candidate gave positive qualitative first-review feedback but did
not report exhaustive counts of factual errors, unsupported claims, or missing
required sections. The fixed zero-count pass therefore remains unverified. This
is not a validated quality result or a default-selection decision.

### Evidence-selection investigation

The accepted draft restores the confirmed employment chronology but largely
lists roles and projects without concrete technical contributions. The captured
evidence contains 13 dated headings within 20 selected chunks. The remaining
selection gives little production Java/platform evidence, despite that material
being available in the approved source and explicitly prioritized by the candidate.
A provider-free local query using those drafting priorities recovered contribution
content absent from the author request.

Issue #556 adds one bounded local priority query and reserves a fitting prefix
of up to three matched non-heading chunks alongside chronology and required-section
evidence. A private replay exposed redundant required-section reservations;
child #557 reuses already-reserved chunks that satisfy the existing section matcher,
instead of consuming an additional slot. The remaining correction was split at
the parent issue's active-work budget before continuing. The same
provider caps, pinned source/version provenance, traces, and factual checks remain
in force.

Lexical selection does not prove relevance, resolve source uncertainty,
or establish that a subsequent live CV will improve. The corrected provider-free
runtime replay retained all 13 discovered dated headings in 20 chunks, including
one chunk with production Java/platform contribution content. Serialized evidence
was 18,321 bytes, and fifteen content-free traces retained retrieval provenance.
These were selection counts, not a CV-quality or efficiency result. The #559
recheck below exposed a required-section coverage defect missed by that replay.

## Frontier recheck after priority reservation (#559)

**Observed:** 2026-09-26 · **Revision:** `a4cba049a1d33774e54c73c4df4b03c06140981d`

The user authorized merging PR #558 and continuing the same private case with
`claude-opus-5-5` and `gpt-6-sol`. The fixed bound remained three author attempts,
one critic call, and 1,200,000 ms including preflight. Authentication probes
passed; the synthetic author preflight succeeded in 2,767 ms.

| Author call | Revision input | Validator result |
| --- | --- | --- |
| 1 | None | Rejected: two uncovered blocks and three required-section omissions |
| 2 | Validation feedback | Rejected: one required-section omission |
| 3 | Validation feedback | Rejected: two uncovered blocks |

All three attempts received factual-validation verdicts. The bounded observation
failed without an accepted draft or critic call; this is not an indeterminate
transport error. Provider wall time including preflight was 354,401 ms; accounted
workflow time was 385,055 ms. Approval remained pending and readiness false. No
export, submission, or default change occurred. Private inputs and captured
outputs remain local.

### Required-section selection correction (#560)

The captured evidence retained thirteen dated headings and technical contribution
content, but omitted the actual education, credential, and language records.
Policy text mentioning these categories satisfied the broad reuse matcher and
displaced their dedicated supplements. The previous replay checked chronology
and technical contributions without asserting those source records.

Issue #560 limits supplement reuse to Experience covered by guaranteed chronology
chunks. Other required sections retain dedicated reservations. The priority query
uses the first explicit `Prioritize` clause when present, reducing policy-text
competition; the full candidate instructions still reach the author unchanged.
The correction preserves the existing evidence limits and factual validator.

The final rejected proposal also contained uncited statements describing missing
event-sourcing and language evidence. The approved source has no explicit
event-sourcing experience statement, so retrieval cannot establish that requested
gap as a candidate fact. Restoring language records addresses one selection
defect; it does not establish that all coverage failures or the live evaluation
will pass. No source facts were invented or amended.

The corrected provider-free replay asserts the actual degree, credential-list,
and language-proficiency source records, rather than category vocabulary alone.
All were retained alongside thirteen dated headings and one production
Java/platform contribution chunk within twenty chunks and 12,707 serialized bytes.
Fifteen content-free retrieval traces preserved provenance. Fictional regression
fixtures cover the same policy-displacement pattern for CI and other developers;
restoring the former broad reuse filter makes the actual-record regression fail.
This proves the targeted selection correction; no additional live workflow has
run after it, and the frontier quality pass remains unverified.

## Frontier recheck after protecting section records (#562)

**Observed:** 2026-09-27 (Europe/Paris) · **Revision:** `42e16cb437533dbb5a09ce9b062206b3c98824be`

The user requested the next observation after merging PR #561. The same approved
private case and authenticated `claude-opus-5-5`/`gpt-6-sol` pair retained the
three-author/one-critic, 1,200,000-ms bound including preflight. Both probes passed;
the synthetic author preflight succeeded in 4,721 ms.

The first author attempt was rejected for two factual-invariant violations and
one uncovered block. Local replay reproduced a combined date range absent from
any single cited chunk, an unsupported literal title prefix, and an uncited
negative-experience statement. The second attempt was accepted with seven
sections and 63 claims. One critic call completed with a funding-attribution
error, eight duplicate-content warnings, sixteen deterministic uncovered-requirement
warnings, and five additional content warnings.

Provider wall time including preflight was 178,015 ms; accounted workflow time
including preflight was 222,224 ms. The workflow stopped awaiting approval, with
readiness false and approval pending. The source-selection check retained actual
degree, credential, and language records, thirteen dated headings, and one
production technical-contribution chunk within twenty chunks and 12,706 bytes.

### Candidate review and source corrections

The candidate disputed the funding error, rejected the negative production-experience
assumption, and clarified that the training included formal awards. The candidate
confirmed three quality weaknesses: sparse recent-role accomplishments, repeated
project entries without contributions, and outdated skill emphasis. A separate
credential-date conflict remains unresolved. No exhaustive category counts were
supplied, so the strict zero-count pass remains unverified.

Investigation found that the saved writing instructions explicitly asserted an
experience gap. Corrected private working instructions remove that assumption.
Candidate-confirmed facts were integrated into a separate private working profile;
the original evaluation inputs, accepted draft, selected source version, and
captures remain unchanged. Nothing personal was published or exported.

### Production-skills evidence selection (#563)

A provider-free replay on the corrected working profile still selected an old
technology-transition paragraph for Skills while omitting the explicit production
skills inventory. A bounded local query recovered that inventory. Issue #563
promotes matched substantive `Production experience:` records within the Skills
supplement, preserving chronology, other actual section records, provenance, and
the existing item/byte caps. This is one selection correction; recent-role
accomplishment coverage and project quality require separate verification.

A provider-free proof on the corrected full private profile retained thirteen
dated headings, actual degree, credential and language records, the explicit
production-skills inventory including the confirmed language-version migration,
and recent production-backend evidence. The older transition paragraph was
absent. Selection remained at twenty chunks, 14,224 bytes, and sixteen
content-free traces, with no provider calls. Fictional CI fixtures protect the
same outcome; disabling record promotion makes the focused regression fail.
Ordinary Skills retrieval remains available when no explicit record exists.

### Bounded live follow-up (#563)

The candidate requested continuation after correcting source facts. One fresh
workflow used the same job description, the full private corpus updated only
with those confirmations, and corrected writing priorities. This is an input
variant, not an unchanged-case comparison. The pair remained authenticated
`claude-opus-5-5` and `gpt-6-sol`, with three author attempts, one critic call,
and 1,200,000 ms including preflight. Both probes passed; synthetic author
preflight succeeded in 2,333 ms. The prepared evidence retained twenty chunks,
thirteen dated headings, all actual required-section records, the production
skills inventory, and recent backend evidence in 14,216 bytes and sixteen traces.

The first attempt was rejected for two factual-invariant violations and one
uncovered block. Private replay reproduced introductory modifiers being included
in protected technology/title phrases despite the underlying values appearing
in cited evidence; a skills-category label separately failed block coverage.
This identifies a validator follow-up, without changing grounding during the run.
The second author draft passed with eight sections and 94 claims. One critic
call reported no errors, nine duplicate-content warnings, fourteen deterministic
uncovered-requirement warnings, and five content warnings: missing contributions
in other recent roles, project labels without substance, thin Java-platform
accomplishment evidence, implicit production status, and past-role summary framing.

Provider wall time including preflight was 327,975 ms; accounted workflow time
including preflight was 379,884 ms. The harness blocked the requested post-critic
revision at the declared first-review boundary. The application consequently
records a nonretryable revision error; both admitted provider steps completed,
and the accepted draft and findings were saved for private candidate review.
No additional workflow, approval, or export occurred. Candidate category counts
remain pending; critic error counts alone do not establish the fixed quality pass.

The full repository gate passed before this run: 2,042 tests in 136 files plus
60 release/security tests. Architecture and evaluation documentation describe
the internal selection change; there is no new command or user-facing option.

## Full-profile comparison and local grounding follow-up (#564)

**Observed:** 2026-09-27 (Europe/Paris) · **Base revision:** `f26663ab3f8e7cbce6c319e7bf6c633256991569`

The candidate reported that their manual two-model workflow no longer omitted
role contributions. Local comparison found 189 normalized profile chunks,
121,405 bytes of normalized text, and only 7,136 text bytes in the twenty-chunk
handoff. Six of seven main experience entries received no body content. A
lossless adjacent packing experiment preserved the normalized text in forty-two
citation packets, within four thousand characters each; provider-facing evidence
serialized to 136,126 bytes. The application, rather than provider adapters,
imposes the twenty-item/128-KiB handoff limits.

The existing consent excluded a complete corpus in one provider request. The
candidate explicitly authorized one prepared full-profile comparison using the
same job, corrected profile, signed-in model pair, three-author/one-critic cap,
and twenty-minute limit including preflight. Credentials, filesystem paths and
baseline attachments were excluded. Nothing was published or exported. Both
sign-in probes passed and synthetic author preflight took 2,344 ms.

The first request ended with an invalid-response error before a proposal reached
validation; its original control log omitted detailed diagnostics. A second
permitted request with response-metadata capture confirmed generation exhaustion
at the 16,384-token ceiling and no structured proposal. This was an output-budget
failure, not evidence of an authentication problem or an inaccurate CV.

The final permitted request used a recorded private 32,768-token generation
variant with matching prompt and request budget. It returned structured content
using 27,573 generated tokens. This differed from the production author
prompt budget at the time and remains a separate variant observation. The
proposal contained nine sections and 148 claims. Contribution detail returned
to the previously sparse roles; current independent work appeared mainly in
Selected Projects with an overview in Experience.

The local validator rejected three spans: an exact cited international phone
field, an opening action incorrectly joined to a technical name, and a terminal
navigation reference to an existing section. Private replay reproduced them.
Issue #564 addresses these narrow support/coverage cases using fictional positive
and adversarial fixtures. The provider output remains unchanged for local replay.
This does not implement full-profile product transmission or alter model defaults.

Three author calls and no critic call occurred. The provider request durations
were 158,235, 160,254 and 270,956 ms; accounted processing including preflight was
591,961 ms. The comparison and investigation completed within the authorized
wall-clock bound. No accepted draft or candidate adjudication established the
fixed quality pass. The result is indeterminate, with a captured validator
rejection and reproducible local defects. No further provider call is admitted
by this comparison.

### Local replay verification

The unchanged private capture passes `buildAuthorArtifact` after the narrow
fixes for #564. It produces nine sections and 150 normalized claims from the 148-claim proposal;
the original capture hash is unchanged. This replay makes no provider calls and does not approve or export
the artifact. Fictional regression cases cover the accepted shapes and unsupported
phone, acronym and section-reference variants. A local validator acceptance is
not a critic review or a reference-quality pass; that evaluation remains pending.

## Corrected-profile recheck at capped effort (#564)

**Observed:** 2026-09-27 (Europe/Paris) · **Base revision:** `fdff153992957ef0585923b477a4af7f269a42fe`

A separately admitted critic-only follow-up completed in 12,270 ms with
GPT-6 Sol at the application's configured low effort. It reported one factual
error and three warnings; deterministic validation also reported the word limit.
Local investigation confirmed a stale source attribution contradicted by later
candidate corrections. A private next-run copy corrected that stale bullet;
historical sources, proposals and captures remained unchanged.

The candidate then capped DraftLoop reasoning at medium and authorized the
prepared revision. The new input retained complete normalized profile text,
corrected attribution and explicit instructions to omit unsettled timing,
preserve role contributions and meet 950 words. Both authentication probes
passed. The author used explicit medium effort with the recorded 32,768-token
ceiling variant; the critic remained low. The admission allowed two author
attempts and one critic call within twenty minutes including preflight.

Both author attempts returned structured content but were rejected for the same
opening action and definite software-appositive span, despite direct support in
its cited source. The attempts took 251,751 and 241,092 ms; accounted elapsed
time was 493,348 ms. No critic call followed. The bounded local grammar fix adds
one action verb and closed software qualifiers; fictional fixtures preserve
absent-name, employer, title and linking-predicate rejection.

Unchanged private replay now constructs nine sections and 150 normalized claims.
The historical capture is unchanged. Deterministic validation still reports
`max-words-exceeded`, so this is not a quality pass or a completed author–critic
evaluation. A targeted shortening input is prepared locally; the two-author
admission does not permit a third request. Nothing was approved, exported or
published.

## Targeted shortening and description grounding (#565)

**Observed:** 2026-09-27 (Europe/Paris) · **Author revision:** `26f1ee2bcfe1beebc4a0c46be07a6c4aea83e07d`

The candidate explicitly admitted one targeted author request at medium effort,
then one critic request at low, within twenty minutes including authentication
preflight and with no automatic retry. The prepared input retained the same
corrected profile and job and supplied section budgets targeting 850 words under
the existing 950-word maximum. Both authentication probes passed. The full local
gate passed before transmission: 2,060 tests in 137 files and 60 release/security
checks.

The author returned an 856-word structured proposal in 210,811 ms. Local grounding
rejected three source-backed software-description spans: a language/platform
compound, a project/stage label, and an opening action with a language-qualified
software appositive. Private investigation reproduced each false rejection.
Issue #565 addresses those grammar cases while retaining cited support for every
component and preserving identity, employer, title and date checks. No second
author call is admitted. The unchanged capture remains private; strict quality
is unverified until local replay, independent critique and candidate review finish.

### Unchanged shortening replay

After the bounded #565 grammar fixes, the unchanged private capture constructs
nine sections and 116 normalized claims. The visible text remains 856 words;
deterministic validation reports no errors. The capture hash is unchanged and
local replay makes no provider calls. Each newly separated component remains
subject to cited-source checks. Fictional regressions cover missing components,
near-match language words, and employer, title and linking contexts.

The author output was produced at the earlier revision; the local grounding
revision is a separately recorded evaluation variant. This is not an
unchanged-production-template reference pass.

### Independent review and candidate verdict

The remaining admitted critic request completed at low effort in 12,377 ms,
within the original twenty-minute window. Total elapsed time was 999,988 ms
(16 minutes 40 seconds), with exactly one author request and one critic request.
The critic reported no errors and three warnings concerning skill scope,
accomplishment scope, and underused role-relevant evidence. These warnings remain
visible for candidate review; a zero-error critic report does not establish the
fixed first-review pass.

The candidate has been asked for counts of factual errors, unsupported claims,
and missing required sections. The candidate confirmed all three findings. This observation therefore fails
the quality review; exhaustive category counts were not supplied. A separate
private revision narrows both scope claims and adds source-backed role detail.
It preserves the reviewed draft and has not undergone independent review.
Neither draft has been approved, exported, or published, and the completed admission permits
no further provider requests. The final local repository gate passed 2,068 tests
in 138 files and 60 release/security checks. Only fictional regression fixtures
and this content-free outcome record belong in the repository.

## Candidate-accepted manual revision

The candidate requested that independent projects appear within their experience
entry, rather than in a separate projects section. The private revision also
narrows two scope claims and restores supported role detail. The reviewed author
output is preserved separately; this is a manual revision with an additional
candidate-supplied presentation source, not a new automated author observation.

The candidate authorized zero author requests and one GPT-6 Sol critic request
at low effort, with a twenty-minute limit and no retries. Local preparation
reconciled the visible draft with its claim references without changing its
text. The revised required-section policy reflects the requested grouping.
Validation passed: 914 visible words, eight sections, 123 claims, and no errors.
The critic completed in 15,862 ms; total admission time was 165,164 ms. It reported
no errors and two warnings about evidence detail and wording clarity.

The candidate confirmed both warnings and explicitly accepted the CV unchanged.
Their quality threshold permits acknowledged, acceptable warnings: a CV need not
be perfect, and some detail belongs in interviews or cannot be disclosed. This
revision is therefore **accepted with warnings**, without inventing numerical
category counts or treating the findings as resolved. Factual errors, unsupported
claims and missing required sections remain blocking concerns; warning severity
alone does not determine acceptance. The previous observation and its failures
remain unchanged.

This result establishes candidate acceptance of a manually revised draft. It
does not establish the milestone's automated first-draft reference outcome,
complete product integration, or authorize export or publication. Candidate
material and the detailed adjudication remain private. No further provider
requests were made.

## Bounded role-body handoff (#569)

A provider-free comparison replayed the historical pinned selection through the
normal CKB handoff. Previously, none of its thirteen selected dated records
contained contribution bodies. With bounded role assembly, twelve do, including
all seven primary experience records. The remaining appendix record cannot fit
its next whole paragraph within the existing 4,000-character limit; the primary
record for that role already contains contributions.

The handoff still selects twenty records, using 34,100 serialized bytes within
the 128-KiB limit. Degree, credential, language and production-skill records remain
present. Fictional regression tests protect pinned-version identity, role
boundaries, whole-chunk limits and consistent inspection identities. No provider
requests were made, and the detailed replay remains private. This establishes
selection coverage, not generated-CV quality or the automated reference outcome.

## Versioned structured-output ceiling (#571)

The production author template now records v4 for new runs, with the 32,768-token
ceiling used by the private generation variant. Earlier templates retain their
original guidance and limits when resumed. Fictional mocked-runtime checks verify
prompt/request agreement, classification of explicit output-limit exhaustion,
recovery, and historical-run preservation. This change authorizes no provider calls and
does not convert the private manual result into an automated reference pass.

## Candidate review of automated recheck (#573)

The normal bounded CKB handoff selected twenty records, including thirteen dated
records and twelve with body text. Two author requests at medium used the v4
ceiling. The first failed coverage for two skills labels; the second passed local
grounding with seven sections and 110 claims. One critic request at low completed
within a total of 685,119 ms, reporting two coverage errors and two warnings.

The candidate requested revision of role contributions and contact information.
Missing independent projects matter when they offer important job-relevant work;
listing every project is not required. A scope warning prompted a private source
clarification. No exhaustive zero counts or quality acceptance were supplied.
The accepted manual revision and historical observations remain unchanged.

Offline investigation showed that body text can contain introductory context
without accomplishments, and requested project evidence was absent from the
selection. #574 addresses explicit contribution blocks; contact and relevant
project selection are ordered follow-ups. No subsequent model calls occurred.

Two local harness guards stopped requests before transmission: an absolute
manifest path was excluded, and critic stdin parsing was corrected. The recovered
critic result remains separate from the application snapshot's local error; run
history was not rewritten. Sources, drafts, requests and detailed findings stay
private. Nothing was approved, exported or published.

## Contribution-block selection (#574)

A provider-free replay of the same pinned case now includes the oldest role's
source-backed processing and Java application contributions, both absent from
that role's previous record. It retains all thirteen dated records within twenty
selected records and 55,673 serialized bytes. The checked role record is 3,968
characters, within the existing per-record limit. Fictional regressions protect
complete list items, nested caveats, exact source ranges and contribution-region
boundaries. This proves the bounded input improvement, not revised CV quality;
Relevant-project coverage remains a separate follow-up.

## Contact evidence selection (#575)

A provider-free replay of the same pinned case now retains the supplied email,
phone and profile link without changing their source text or provenance. It
keeps all thirteen dated roles and the oldest role's contribution evidence within
twenty records and 52,892 serialized bytes. Fictional regressions cover contact
labels, mixed identity and disclosure clauses, misleading mentions and a full
twenty-record merge. This confirms input coverage; it does not establish a revised
CV outcome or authorize another provider call. Candidate material stays private.
