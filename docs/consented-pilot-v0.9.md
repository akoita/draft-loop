# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-09-08<br>
**Cases:** Twelve bounded observations of one consented, anonymized case

## Result

The predeclared workflow-parity gate remains **INDETERMINATE**. The live
workflow has not produced a human-approved artifact, so these
observations cannot establish factual parity, professional readiness, or
reduced review effort.
It does not validate the v0.9 product outcome and does not authorize release
preparation.

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
verification before another live observation.

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
- The existing private manual CV was retained as the human baseline. It
  targets a related backend-engineering role rather than the evaluated SDK
  role, so any comparison must treat the role mismatch as a limitation. The
  eighth draft emphasized API and developer-tool evidence more directly, while
  the baseline retained a stronger backend-production narrative. Because the
  draft still lacked an adjudicated revision and approval, the predeclared
  readiness and review-effort comparison remained unscoreable.
- Misleading-evidence and prompt-injection behavior were not tested in this
  live case. The provider-free synthetic preflight remains implementation
  evidence only.
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

Issue #75 stays open, and release preparation under #250 remains blocked.
No final candidate approval, export, or submission is authorized by these
results. Any further live attempt needs its own bounded authorization.
