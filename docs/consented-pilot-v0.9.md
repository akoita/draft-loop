# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-09-06<br>
**Cases:** Eleven bounded observations of one consented, anonymized case

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
remains available in the earlier durable snapshot. Issue #303 owns the bounded
parent-first persistence fix. No new candidate adjudication, approval, export,
or submission occurred, and the predeclared comparison remains indeterminate.

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

Keep the workflow-parity outcome unvalidated. Issue #249 records the initial
observation, #262 records the corrective rerun, and #266 records the
grounding-guide observation. Issue #271 records the structured-recovery
observation, while #275 records the post-citation-completion observation. The
sixth observation is recorded by #286, #287 removed its typed-history storage
blocker, and #290 records the confirmed but exhausted adjudication
continuation. Issue #291 records the declared-timeout observation, #293
delivered content-free failure-stage classification, #296 records the
classified author-exhaustion observation, and #298 records the tenth observation.
Issue #302 records the eleventh observation after #300's numeric-grounding
correction. Resolve the artifact-ancestry projection blocker in #303 before
continuing the preserved run. Issue #75 stays open, and release-preparation
issue #250 remains blocked. No approval or export is authorized by this result.
