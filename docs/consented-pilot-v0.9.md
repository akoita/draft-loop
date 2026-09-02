# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-09-02<br>
**Cases:** Seven bounded observations of one consented, anonymized case

## Result

The predeclared workflow-parity gate remains **INDETERMINATE**. The live
workflow did not produce a revised, human-approved artifact, so these
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

Private thresholds and scores remain outside the repository. The fifth and
sixth observations produced accepted drafts and independent critiques, while
the seventh staged the confirmed adjudication but produced no revision. None
cleared readiness or completed an adjudicated revision. The gate therefore
remains indeterminate rather than treating unresolved findings as accepted
facts.

## Outcome boundary

- Provider roles remained Anthropic `claude-sonnet-4-5` as author and OpenAI
  `gpt-5.6-luna` as critic. The initial observation reached both roles; the
  corrective observation exhausted three author attempts before critique; the
  grounding-guide observation failed at the Anthropic transport boundary; the
  structured-recovery observation exhausted three author attempts before
  critique; the fifth observation completed both roles on their first
  attempts; the sixth reached an accepted author result on attempt three before
  the critic completed on attempt one; and the seventh exhausted one
  authentication failure plus two default-timeout revision attempts before a
  new artifact existed. Provider-reported cost remained unavailable.
- Human approval and export were not completed. Review time, edit count, and
  user confidence were therefore unavailable.
- The existing private manual CV was retained as the human baseline. It
  targets a related backend-engineering role rather than the evaluated SDK
  role, so any future comparison must treat the role mismatch as a limitation.
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
continuation. Issue #291 owns one fresh same-scope observation with the
already-supported request timeout explicitly aligned to the declared case
budget. Issue #75 stays open, and release-preparation issue #250 remains
blocked. No approval or export is authorized by this result.
