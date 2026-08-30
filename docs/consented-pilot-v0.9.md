# v0.9 consented workflow-parity result

**Status:** Indeterminate  
**Recorded:** 2026-08-30  
**Cases:** One consented, anonymized case

## Result

The predeclared workflow-parity gate is **INDETERMINATE**. The live workflow
did not produce a revised, human-approved artifact, so this observation cannot
establish factual parity, professional readiness, or reduced review effort.
It does not validate the v0.9 product outcome and does not authorize release
preparation.

The initial attempt completed one Anthropic author step and one independent
OpenAI critic step. Its revision call timed out. Under the candidate-approved
extension, one fresh retry used the same model pair and sanitized data scope
with a 20-minute case budget. The Anthropic author call reached the current
user-session adapter's 120-second per-call timeout before returning a draft.
No further provider attempt was made.

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

Private thresholds and measurements remain outside the repository. The
initial draft did not clear readiness, but no revised artifact exists against
which to evaluate the gate.

## Outcome boundary

- Provider roles were Anthropic `claude-sonnet-4-5` as author and OpenAI
  `gpt-5.6-luna` as critic. Provider-reported cost was unavailable.
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

Keep the workflow-parity outcome unvalidated. Issue #249 records the attempted
consented observation. The #75 outcome rollup stays open, and release-preparation
issue #250 remains blocked pending a complete consented comparison. Before
another live attempt, expose a bounded user-session request timeout that can
honor the declared case budget, then obtain fresh provider-transmission approval.
