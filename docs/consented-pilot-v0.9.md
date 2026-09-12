# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-09-12<br>
**Cases:** Sixteen bounded observations across two consented, anonymized cases

## Result

The predeclared workflow-parity gate remains **INDETERMINATE**. The live
workflow has not produced a human-approved artifact, so these
observations cannot establish factual parity, professional readiness, or
reduced review effort.
It does not validate the v0.9 product outcome and does not authorize release
preparation.

The sixteenth observation (#360) repeated the content-free provider rate-limit
outcome on the matched-backend gate. All three author attempts failed before an
artifact or independent review existed, so it adds no product-quality evidence
and does not change the indeterminate result.

The initial attempt completed one Anthropic author step and one independent
OpenAI critic step. Its revision call timed out. Under the candidate-approved
extension, one fresh retry used the same model pair and sanitized data scope
with a 20-minute case budget. The Anthropic author call reached the current
user-session adapter's 120-second per-call timeout before returning a draft.
No further provider attempt was made.

After the bounded timeout, grounding-prompt, and corrective-retry blockers were
closed, a second observation reused the same model pair, private sanitized data
scope, and 20-minute case limit under the candidate's standing authorization.
The first Anthropic author response exceeded the output-token boundary. The
corrective retry cleared that boundary but failed one local factual-invariant
claim-text path. The final bounded retry failed a different single claim-text
path. No author response was accepted, so the OpenAI critic was not called in
this observation.

After the deterministic grounding guide was merged, a third observation reused
the same private case, model pair, and case limit. Repeated same-scope starts
failed before author output. Content-free instrumentation confirmed a
structured HTTP 429 response without quota markers, but the nonzero CLI exit
was recorded as non-retryable `unknown` before the structured status could be
classified. The local Claude session remained installed and authenticated. No
author response was accepted, and the OpenAI critic was not called.

After structured Claude error recovery was merged, a fourth observation reached
all three bounded author attempts. The first response exceeded the output-token
boundary. The second response failed three local factual-invariant claim-text
paths. Corrective feedback reduced the final response to one repeated
claim-text path, but no proposal was accepted and the OpenAI critic was not
called.

After exact-value citation completion was merged, a fifth observation completed
the Anthropic author and OpenAI critic on their first attempts. The workflow
reached the explicit human boundary with an artifact and independent critique,
but readiness was false. Eight warnings and one unresolved error included six
uncovered requirements, one omitted transition, one unsupported-claim finding,
and one section-label mismatch. The run stopped without adjudication, revision,
approval, export, or submission.

After exact adjudication staging and active-duration accounting were merged, a
sixth fresh observation reused the same private scope and model pair. Its first
two Anthropic author attempts failed local factual-invariant validation on one
and then two content-free claim paths. The third attempt produced an accepted
draft, and the OpenAI critic completed on its first attempt. The run reached
human review after 307 seconds of active time, well inside the 20-minute cap.
Readiness remained false with eleven warnings and one error across seven
uncovered requirements, one missing transition entry, and four additional
coverage or quality findings.

Those findings were materially different from the fifth observation, so its
confirmed adjudication was not reused. The run stopped without revision,
approval, export, or submission. After the orchestration snapshot was already
durable, the typed-history projection rejected the new artifact because an
earlier run in the same workspace already owned artifact version 1. The
snapshot remains readable; issue #287 owns this separate storage blocker.

After migration 26 removed that blocker, the candidate reviewed all twelve
findings and confirmed one accept, two rejects, and nine nuanced decisions.
The exact package was staged locally before provider execution, including one
bounded accepted effect to restore the documented transition-period entry.
Both independent version-1 artifacts then persisted in typed history with no
foreign-key violation.

The seventh observation did not produce a revision. Its first revision attempt
used the generic CLI's API-key default instead of the declared user-session
route and failed authentication. The two remaining attempts used the intended
authenticated Anthropic session but retained the adapter's 120-second default;
both timed out before returning an accepted artifact. The run exhausted its
three-attempt boundary after 585 seconds of cumulative active provider time,
inside the 20-minute case cap. This was an operator timeout-configuration
error, not a provider credit or quota failure. The run remains immutable and
no revision, new critique, approval, export, or submission occurred.

The eighth observation applied the declared 1,200,000 ms timeout to every
user-session subprocess. Its first two author attempts returned invalid
structured responses; the third produced an accepted draft, and the critic
completed on its first attempt. The resulting ten findings were materially
different from the previously confirmed twelve, so the workflow stopped for
fresh human review. The candidate then confirmed two accepts, two rejects, and
six nuanced decisions. That exact package and two bounded accepted effects
persisted locally before revision execution.

All three revision attempts returned before timeout but failed structured-
response validation. The run exhausted its revision-attempt boundary after
959 seconds of cumulative active provider time, inside the 20-minute cap. This
was not an authentication, timeout, credit, or quota failure. No revised
artifact, second critique, approval, export, or submission occurred. Issue #293
delivered content-free failure-stage classification (`transport-parsing`,
`response-schema-validation`, `artifact-schema-validation`,
`factual-invariant-rejection`) and sanitized 10-finding deterministic
verification before another live observation. Issue #348 extends that
vocabulary with `output-token-budget-exceeded` for future output-token budget
overruns; existing observation records retain their original classifications.

The ninth observation under issue #296 exercised the failure-stage
classification runtime delivered in #293 using the declared 1,200,000 ms timeout
and standing candidate authorization. The first Anthropic author attempt failed
local factual-invariant validation on three claim paths, classified as
`factual-invariant-rejection`. Corrective retry feedback was applied, but attempt
two failed three different claim paths under the same stage. Corrective feedback
for attempt three reduced the failure to one repeated claim path, which still
failed factual-invariant validation. The run exhausted its three author attempts
after 313 seconds of active provider time, inside the 20-minute cap. The
content-free failure stage (`factual-invariant-rejection`) and diagnostic
violation paths were preserved without leaking candidate prose or private data.
No draft was accepted, so the OpenAI critic was not invoked, and no
adjudication, revision, approval, or export occurred.

The tenth observation under issue #298 used the declared 1,200,000 ms timeout
and standing candidate authorization. The first Anthropic author attempt failed
local factual-invariant validation on three claim paths (`sections.1.blocks.0.claims.3.text`,
`sections.1.blocks.0.claims.5.text`, `sections.1.blocks.0.claims.6.text`), classified
as `factual-invariant-rejection`. The second attempt exceeded the output-token budget
(`output_token_budget_exceeded`). The third attempt applied concise-output feedback
and resolved the token excess plus two of the prior factual-invariant violations, but
failed one remaining claim path (`sections.1.blocks.0.claims.5.text`) under
`factual-invariant-rejection`. The run exhausted its three author attempts after 412
seconds of active provider time, inside the 20-minute cap. No draft was accepted, so
the OpenAI critic was not called, and no adjudication, revision, approval, or export
occurred.

The eleventh observation under issue #302 ran after the whole-numeric grounding
correction in #300, using the same consented scope, model pair, and declared
timeout. The author, independent critic, automatic revision, and second critic
each completed on their first attempt. The durable snapshot reached human
review in round two with artifact version 2 after 239 seconds of active
provider time. This is the first recorded completed revision in these
observations; it was an automatic revision, not a candidate-adjudicated one.

Readiness remained false with thirteen warnings and one error: three duplicate-
content warnings, seven uncovered requirements, an omitted transition, and
three evidence/quality warnings. After the snapshot was durable, typed-history
projection failed with `SQLITE_CONSTRAINT_FOREIGNKEY`. The application tried to
save version 2 before its version-1 parent existed in typed history. The parent
remained available in the earlier durable snapshot.

The #303 recovery on 2026-09-08 used the application resume contract with
provider transmission disabled after a private database backup. It projected
both artifacts and all four executions in dependency order. Durable snapshots
and execution history were unchanged, with zero new provider calls. The run
remained in round-two human review, readiness false and approval pending. No
new candidate adjudication, approval, export, or submission occurred, and the
predeclared comparison remains indeterminate.

## Approved continuation of the recovered draft (#306)

The candidate approved the exact version-2 review packet on 2026-09-08.
Fourteen accepted decisions ask the author to restore source-backed chronology,
clarify staging versus production, reduce repeated wording without losing facts,
and address coverage only where the selected evidence supports it. Nine explicit
conditional overrides preserve honest gaps instead of requiring invented
experience or SDK ownership.

The shared application contract staged these decisions without provider calls.
The continuation retains the existing Anthropic author, OpenAI critic,
user-session authentication, 1,200,000 ms request timeout, three-attempt step
limit, and cumulative 20-minute provider budget. It starts round three with
238,896 ms already consumed. Candidate approval of the revision instructions
does not approve the CV or authorize export or submission.

The first revision attempt exceeded the output-token boundary after 306 seconds
of active provider time. The second returned after another 129 seconds but
failed local factual-invariant validation. The third exceeded the output-token
boundary after another 254 seconds. All three permitted attempts were exhausted
without an accepted revised artifact or a new critic call. The continuation
used 689 additional active-provider seconds, bringing the preserved run to
928 seconds within its unchanged 1,200-second cumulative limit.

Artifact version 2 and its fourteen findings remain unchanged. The run is in
`provider-error` with retries exhausted. The approved adjudication remains
persisted, but no candidate-adjudicated revision was produced. No final CV
approval, export, or submission occurred, and parity remains indeterminate.

## Single diagnostic revision with local capture (#314)

On 2026-09-08, the candidate authorized one standalone author revision attempt
on revision `39c0a71999900269d5e1f581b2a771b188fdd4b9`. It used the preserved
version-2 draft, pinned context, sixteen retrieved evidence chunks, and the
exact approved report, fourteen decisions, and nine conditional overrides.
The Anthropic user-session author retained the 8,192-token cap, with a separate
600,000 ms timeout and no retries. This diagnostic request stopped at author
validation; it did not resume or reset the exhausted application run.

The attempt returned after 134,527 ms and failed one factual-invariant check.
Local capture succeeded. Replaying the captured validation inputs reproduced
the failure: the protected-name extractor grouped an opening negation with a
technology name, rejecting a lack-of-experience statement explicitly supported
by the cited source in a different word order. A synthetic reproduction uses
source `No experience: GraphQL.` and claim `No GraphQL experience`; the extracted
`No GraphQL` name fails exact matching, while the source wording passes.
These technology examples are synthetic, not candidate evidence.

Issue #315 owns the bounded grounding correction. The result explains this
captured rejection, not the uncaptured #306 failure. The original database
checksum is unchanged, with version 2 and exhausted retries preserved. No
critic call, accepted application revision, candidate approval, export, or
submission occurred. Parity remains indeterminate and #250 remains blocked.

## Independent critic review of the local revision (#320)

On 2026-09-08, the candidate authorized one standalone OpenAI user-session
critic attempt on revision `6c332e901895a4dedf38e648a1197b03feaa2a1c`. The
version-3 artifact rebuilt from the unchanged #314 capture passed local author
validation and adjudication tracing with all nine approved exceptions. The
critic received the same sixteen retrieved evidence chunks, pinned context,
and seven current deterministic findings. The attempt retained the existing
16,384-token critic cap, with a separate 600,000 ms timeout and no retries.

The critic completed in 17,731 ms, returning two unsupported-date errors, one
section-content warning, and one anonymity warning. The local readiness
projection remains false, with report errors, a disputed dimension, and an
unmet rubric threshold. This diagnostic review did not accept the artifact
into the original application run or authorize candidate approval or export.

Local source inspection distinguishes the date errors. One range is explicitly
supported by an indexed source heading that was absent from retrieved evidence.
The other differs from the source's explicit transition range and instead uses
adjacent employment boundaries. Both relevant headings were omitted from the
sixteen selected chunks. Issue #321 owns bounded chronology preservation in
provider evidence. The section-content warning overlaps known conditional
coverage gaps; the anonymity warning is a critic concern, not an established
violation of an explicit city-exclusion policy.

The original database checksum is unchanged. No author call, retry, candidate
approval, export, or submission occurred. Local structural validation did not
prevent the date error; the revision requires correction and parity remains
indeterminate. Candidate material and full findings remain private.

## Independent review after the local chronology correction (#324)

The candidate authorized one more standalone critic attempt on 2026-09-08,
using revision `1ef3f3f16015c5d9a3faa9d852e54fd6f4ad2f63`. The local correction
replaced the transition range with its exact approved source range and added
explicit source citations for both chronology entries. The corrected artifact
passed author validation and adjudication tracing with all nine original
exceptions. The OpenAI user-session critic received eighteen approved evidence
chunks, including the previously omitted headings, and seven deterministic
findings. The single attempt retained the 16,384-token cap and 600,000 ms timeout.

The review completed in 12,655 ms with no errors and one factuality warning.
The critic did not repeat the earlier date findings. Its remaining warning
concerns summary wording that groups a staging technology with production
systems, potentially overstating production experience. Local inspection
confirmed that the summary uses this grouped wording; the source distinguishes
staging work from production delivery. The local readiness projection remains
false solely because the relevance rubric threshold is unmet.

This is a narrower remaining review surface, not a validated parity outcome.
The original database checksum is unchanged, and the corrected artifact has
not been accepted into the original application run. No author call, retry,
candidate approval, export, or submission occurred. Full findings and candidate
material remain private.

## Local review of the remaining relevance input (#326)

Subsequent source inspection found that the supplied skills record explicitly
lists production experience in the technology named by the #324 warning. The
project-specific staging restriction does not negate that broader source-backed
history, so the critic warning is not established as a factual violation.

The relevance input has a separate defect: local requirement extraction admitted
headings and wrapped-line fragments, kept only the first twelve lines, and
assigned priority from their positions. Its score is therefore not a reliable
job-fit measure. Issue #326 reconstructs twenty-one complete source units with
neutral priority, retaining later criteria, but semantic requirement selection
still belongs to a reviewed opportunity brief. The pinned context and score
remain unchanged; no provider call, CV edit, or threshold change occurred.

## Independent review of approved requirements (#332)

After local extraction and coverage corrections, the candidate approved eighteen
requirements and their priorities in a separate reviewed opportunity context.
One explicitly authorized OpenAI user-session critic attempt assessed the
unchanged corrected draft against those criteria and the same eighteen evidence
chunks. The request did not include prior agent labels or numeric relevance
scores. It retained a 600,000 ms timeout, a 16,384-output-token cap, and no retries.

The attempt completed in 87,700 ms, reporting 49,018 input tokens and 4,537 output
tokens. All eighteen criteria were returned exactly once with valid source and
draft references: seven supported, seven partial, and four not established.
These are raw critic assessments, not accepted coverage judgments. Reference
validity establishes input linkage, not semantic entailment.

Local review found two material interpretation problems: small-startup work
was treated as proof of early-stage experience, and an observability alternative
was narrowed by adding a production technology condition. The raw response is
preserved, and no corrected totals or replacement score are asserted. Missing
SDK-specific experience remains a real limitation; further wording changes
cannot supply absent evidence.

The original database checksum and artifact are unchanged. No author call,
retry, accepted application revision, candidate CV approval, or export occurred.
The existing relevance threshold remains unmet; this diagnostic does not
replace the predeclared gate. Parity stays indeterminate and #250 stays blocked.
Full references, response text, and local review remain private.

## Full observation on the corrected revision (#346)

One fresh run exercised every correction merged since the last live attempt
(#315, #318, #321, #324, #326, #328, #329, #341, and #344) under the standing
authorization and the unchanged model pair. Bounds were predeclared: stop at the
first human review boundary, at most three author attempts and one critic
attempt, a 1,200,000 ms per-request timeout, and a 1,200-second cumulative
active-provider cap. None was raised mid-run.

The first author attempt failed after 247 seconds, returning no output tokens,
with the content-free diagnostic `output_token_budget_exceeded`. It carried no
failure stage in that historical observation, so the recurring output-budget
path was unclassified there even though #293 defined the stage vocabulary.
Issue #348 classifies future occurrences as `output-token-budget-exceeded`
without rewriting this historical observation record. The second attempt failed under
`factual-invariant-rejection`. The third produced an accepted eight-section
artifact, and the independent critic completed on its first attempt. The run
reached the human review boundary in 462 seconds of active provider time, well
inside the cap.

Local readiness is false on one dimension only. Evidence, accuracy,
differentiation, format, and credibility each score 1.0, and clarity scores 0.80,
all at or above their 0.80 thresholds. Relevance scores 0.29: six of the
twenty-one requirements that #326 now extracts are covered, leaving fifteen
uncovered-requirement warnings. One `experience-content-omitted` coverage error
remains; the `missing-transition` errors seen in earlier observations did not
recur.

The uncovered count is not comparable with earlier observations. #326 replaced a
truncated requirement list with twenty-one complete units, so the denominator
changed; the earlier fourteen-warning figure was measured against a different
set. What the corrections demonstrably did not do is lift relevance.

Accuracy and credibility at 1.0 mean the accepted draft introduced no
factual-invariant violation and no unsupported model-added claim. Those are the
gate's fixed requirements, and at this boundary they hold. The gate is still not
met: relevance is far below its threshold, and no adjudication, revision,
approval, export, or submission occurred, so bounded review effort, edit count,
and confidence remain unmeasured.

This result is consistent with the #332 conclusion that missing SDK-specific
experience is a real limitation rather than a wording problem. The case plan
itself records no established maintenance of a widely adopted public SDK as a
known gap for an SDK role. A high-accuracy draft that covers six of twenty-one
requirements is the expected output for an honest CV against a role the
candidate largely does not match. Further coverage-rule work cannot close that
gap on this case.

## Matched-backend observation (#350)

One fresh case used a backend role selected for direct overlap with the
candidate's established Java, distributed-systems, transactional, platform,
and engineering-support experience. The career source and manual CV for the
same role remained private, and the manual CV was withheld from generation.
The comparison gate, provider pair, three-round limit, 1,200,000 ms request
timeout, and 1,200-second active-provider cap were declared before generation.

The first author attempt exceeded the output-token budget after 261 seconds.
The runtime persisted `output-token-budget-exceeded` and the existing
content-free diagnostic, confirming #348 in live use. The bounded corrective
retry produced a seven-section artifact with 35 claims and 137 evidence
references. The independent critic completed on its first attempt. Total active
provider time was 355 seconds, and provider-reported dollar cost remained
unavailable.

The draft reached the human boundary with one error and seventeen warnings.
Relevance was 0.28: five of eighteen extracted requirements were covered by
the deterministic rule. Evidence and accuracy scored 1.0, differentiation
0.99, clarity 0.80, format 1.0, and credibility 1.0. The blocking error was a
required gap disclosure absent from the draft. Warnings included thirteen
uncovered requirements, duplicate content, weak project content, unsupported
skill evidence, and missing role evidence.

Read-only review found that source-backed education, certification, and
language material had been replaced with unavailable-data placeholders. Recent
roles and the required projects section also lost substantive source content.
Issue #351 owns the bounded required-section evidence correction. The private
manual baseline contains the omitted categories and remained available after
that correction. It was reused but withheld from generation in #358 and #360;
neither produced an artifact.

The same review found substantive prose broader than its extracted claim span.
The narrower claim was supported, allowing evidence and accuracy to score 1.0
while adjacent wording escaped claim-level validation. Issue #352 owns that
separate claim-coverage correction. Because factual safety cannot be concluded
from the #350 score and no adjudication, revision, approval, or export occurred,
that matched-backend observation remains indeterminate.

## Bounded matched-backend observation (#358)

On 2026-09-12, after issues #351, #352, and #356 merged, the user explicitly
authorized provider transmission before the run. It reused the existing private
v1 comparison gate and the matched-backend private inputs and manual baseline;
the baseline was withheld from generation. The pair remained Anthropic
`claude-sonnet-4-5` as author and OpenAI `gpt-5.6-luna` as critic, using
authenticated user-session transports.

The existing limits remained fixed: at most three author attempts and one
critic attempt before the first review boundary, a 1,200,000 ms request timeout,
a 1,200-second cumulative active-provider cap, and three rounds. No thresholds
or inputs changed.

All three author attempts failed with a content-free `rate-limit` code.
Attempts one and two were retryable; attempt three exhausted the author cap and
was non-retryable. Persisted active duration was 14,339 ms and token counts were
zero. Provider-reported cost was unavailable (`null`); the workspace aggregate
remained $0 because no billable usage was reported.

No author artifact or critic call occurred, so there were no findings,
readiness scores, human review boundary, adjudication, or revision. No approval,
export, release, or submission occurred. The rate limit is not evidence of a
product defect. This observation adds no outcome evidence, so parity remains
indeterminate and #75 and #250 remain blocked.

## Bounded matched-backend observation (#360)

On 2026-09-12, the user explicitly authorized provider transmission before
execution. The run reused the same private matched-backend inputs, manual
baseline, and v1 comparison gate as #350 and #358; the baseline was withheld
from generation. Anthropic `claude-sonnet-4-5` remained the author and OpenAI
`gpt-5.6-luna` the critic, through authenticated user sessions. Both
authentication probes passed.

The fixed limits were at most three author attempts and one critic attempt
before the first review boundary, a 1,200,000 ms request timeout, a 1,200-second
cumulative active-provider cap, and three rounds.

All three author attempts returned content-free rate-limit failures. Attempts
one and two were retryable; attempt three exhausted the author cap and was
non-retryable. Persisted active duration was 7,508 ms and all token counts were
zero. Per-execution `estimatedUsd` was `null`; the workspace aggregate remained
$0 because no billable usage was reported.

No artifact, critic call, findings, readiness decision, human review,
adjudication, revision, approval, export, submission, or release occurred. The
rate limit is not evidence of a product defect. This observation adds no
product-quality evidence, so parity remains indeterminate and #75 and #250
remain blocked. Any further live attempt needs its own bounded authorization.

## Predeclared comparison gate

| Dimension                     | Status        |
| ----------------------------- | ------------- |
| Factual safety                | Indeterminate |
| Required-section preservation | Indeterminate |
| Chronology preservation       | Indeterminate |
| Relevant-achievement recall   | Indeterminate |
| Critical-requirement coverage | Indeterminate |
| Bounded human review          | Indeterminate |
| Professional readiness        | Indeterminate |
| **Overall**                   | **Indeterminate** |

Private thresholds and scores remain outside the repository. The fifth,
sixth, eighth, and eleventh observations produced accepted drafts and independent
critiques. The seventh and eighth staged exact confirmed adjudications but
produced no revision. The eleventh completed an automatic revision and second
critique but encountered a typed-history persistence failure. None cleared
readiness or completed an adjudicated revision. The gate remains indeterminate rather than treating
unresolved findings as accepted facts.

## Outcome boundary

- Provider roles remained Anthropic `claude-sonnet-4-5` as author and OpenAI
  `gpt-5.6-luna` as critic. The initial observation reached both roles; the
  corrective observation exhausted three author attempts before critique; the
  grounding-guide observation failed at the Anthropic transport boundary; the
  structured-recovery observation exhausted three author attempts before
  critique; the fifth observation completed both roles on their first
  attempts; the sixth reached an accepted author result on attempt three before
  the critic completed on attempt one; the seventh exhausted one
  authentication failure plus two default-timeout revision attempts before a
  new artifact existed; the eighth reached author success on attempt three and
  critic success on attempt one, then exhausted three invalid-response revision
  attempts with the declared timeout in force; the ninth exhausted three
  author attempts under `factual-invariant-rejection`; and the tenth exhausted
  three author attempts across token-budget excess and `factual-invariant-rejection`.
  Provider-reported cost remained unavailable.
- Human approval and export were not completed. Review time, edit count, and
  user confidence were therefore unavailable.
- The eleventh observation completed both author steps and both critic steps
  on their first attempts, within the existing 20-minute active-provider cap.
  It reached human review with a revised artifact preserved in the durable
  snapshot; typed-history projection failed on the missing parent row. This
  progress does not establish factual parity or application readiness.
- The earlier SDK-role comparison used the existing private manual CV as its
  baseline, but the roles differ. The eighth draft emphasized API and
  developer-tool evidence more directly, while the baseline retained a stronger
  backend-production narrative. Matched-backend observations #350, #358, and
  #360 used a separate matched-role case and manual baseline. #358 and #360
  reused those private inputs, with the baseline withheld from generation, but
  produced no artifact to compare.
- Misleading-evidence and prompt-injection behavior were not tested in these
  live observations. The provider-free synthetic preflight remains
  implementation evidence only.
- Candidate material, opportunity content, provider responses, private gate
  values, credentials, source paths, and identifying values remain outside the
  repository and CI artifacts.

## Decision

Keep the workflow-parity outcome unvalidated. The observations above document
progress through drafting, independent critique, automatic revision, and
recovery, but none completed the approved candidate-adjudicated revision or
cleared the predeclared comparison gate.

The #303 recovery preserved the #302 draft. All three #306 continuation
attempts then failed the output-token or factual-invariant boundary. The
separately authorized #314 diagnostic attempt captured a source-backed
negative-experience false positive; #315 owns its correction. Keep the approved
decisions and version-2 draft, with the original run's exhausted retries intact.

The #320 independent critic review found a chronology error and missing source
context after local validation passed. Issue #321 owns the evidence-selection
correction; the current revised artifact remains unapproved.

After the local chronology correction, #324 returned one staging-versus-production
warning and no errors. The relevance threshold remains unmet, so further
candidate review must preserve honest coverage gaps rather than invent experience.

The #346 observation then ran the corrected revision end to end to the human
review boundary. It reached an accepted draft and an independent critique with
no factual-invariant violation and no unsupported model-added claim, but
relevance covered six of twenty-one requirements against a 0.80 threshold. The
corrections merged since #332 did not lift relevance, which is consistent with a
genuine role mismatch rather than a defect. No adjudication, approval, or export
followed.

The #350 matched-backend observation reached an accepted author draft on its
second attempt and completed independent critique. It exposed source-backed
required-section omissions (#351) and substantive prose outside the validated
claim graph (#352). These defects prevent factual-safety and completeness
claims even though the artifact reached the review boundary.

The fifteenth observation under #358 reused the matched-backend gate after
issues #351, #352, and #356 merged, with explicit provider-transmission
authorization before execution. All three author attempts failed with
content-free rate-limit responses before an artifact existed. No quality gate
was exercised, so this provider outcome supports no product-defect claim and
does not validate the merged corrections.

The sixteenth observation under #360 reused the same matched-backend inputs and
gate with explicit provider-transmission authorization. Both authentication
probes passed, but all three author attempts again failed with content-free
rate-limit responses before an artifact existed. It also exercised no quality
gate and adds no product-quality evidence.

Issue #75 stays open, and release preparation under #250 remains blocked.
No final candidate approval, export, or submission is authorized by these
results. Any further live attempt needs its own bounded authorization.

The first case remains limited by role mismatch. The matched case provides
product evidence from #350 about required content and claim validation. The
rate limits in #358 and #360 added no product-quality evidence and do not
change the indeterminate outcome.
