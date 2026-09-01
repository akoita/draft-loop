# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-09-01<br>
**Cases:** Five bounded observations of one consented, anonymized case

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

Private thresholds and scores remain outside the repository. The fifth
observation produced an accepted draft and independent critique, but it did not
clear readiness or receive candidate adjudication. The gate therefore remains
indeterminate rather than treating unresolved findings as accepted facts.

## Outcome boundary

- Provider roles remained Anthropic `claude-sonnet-4-5` as author and OpenAI
  `gpt-5.6-luna` as critic. The initial observation reached both roles; the
  corrective observation exhausted three author attempts before critique; the
  grounding-guide observation failed at the Anthropic transport boundary; the
  structured-recovery observation exhausted three author attempts before
  critique; and the fifth observation completed both roles on their first
  attempts. Provider-reported cost remained unavailable.
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
Issue #75 stays open, and release-preparation issue #250 remains
blocked. Candidate review of the private findings and an explicit adjudication
decision are required before any revision, approval, or export.
