# v0.9 consented workflow-parity result

**Status:** Indeterminate<br>
**Recorded:** 2026-08-31<br>
**Cases:** Two bounded observations of one consented, anonymized case

## Result

The predeclared workflow-parity gate remains **INDETERMINATE**. The live
workflow did not produce a revised, human-approved artifact, so these
observations cannot
establish factual parity, professional readiness, or reduced review effort.
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

Private thresholds and measurements remain outside the repository. The initial
draft did not clear readiness, and the corrective observation produced no
accepted artifact against which to evaluate the gate.

## Outcome boundary

- Provider roles remained Anthropic `claude-sonnet-4-5` as author and OpenAI
  `gpt-5.6-luna` as critic. The initial observation reached both roles; the
  corrective observation exhausted three author attempts before critique.
  Provider-reported usage and cost were unavailable for the failed attempts.
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
observation, and #262 records the corrective rerun. The #75 outcome rollup stays
open, and release-preparation issue #250 remains blocked pending a complete
consented comparison. Do not repeat the unchanged run: first bound the remaining
author factual-invariant reliability failure as a separate execution issue.
