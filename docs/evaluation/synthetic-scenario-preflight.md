# Synthetic scenario preflight

The `@draft-loop/evaluations` synthetic runner is a local, provider-free
preflight for the v0.9 trust boundary. It executes eight sanitized scenarios
against a supplied `DraftArtifact` and `ReadinessEvaluationContext`. The
runner reuses deterministic artifact validation and readiness evaluation, then
adds only the bounded observations that those contracts do not represent.

## Expected matrix

Each scenario has one intended outcome. The runner does not select a fixture
agent or call an author, critic, web research service, or other provider.

| Scenario ID | Expected status | Reason code |
| --- | --- | --- |
| `strong-match` | `pass` | `complete-supported-artifact` |
| `critical-skill-gap` | `blocked` | `critical-skill-gap` |
| `chronology-conflict` | `blocked` | `unresolved-chronology-conflict` |
| `prompt-instruction-ignored` | `pass` | `prompt-instruction-ignored` |
| `candidate-selection-isolation` | `pass-with-isolation` | `candidate-selection-isolated` |
| `missing-required-section` | `blocked` | `missing-required-section` |
| `opportunity-conflict` | `blocked` | `unresolved-opportunity-conflict` |
| `unsupported-metric` | `blocked` | `unsupported-metric` |

The critical-skill-gap case represents an honest mismatch such as a candidate
without the required Rust, Azure, and GPU experience. The prompt case marks an
embedded instruction as untrusted requirement text; leaving it uncovered is a
pass, while covering it produces the blocking `prompt-instruction-followed`
reason. Candidate isolation passes only when every substantive claim maps to a
known selected candidate and at least one known candidate remains unselected.

## Bounded result contract

`runSyntheticScenario` accepts exactly these top-level fields:

- `scenarioId`: one of the eight IDs in the matrix;
- `artifact`: one schema-valid `DraftArtifact`;
- `context`: one `ReadinessEvaluationContext`;
- `observations`: optional bounded counts, untrusted-instruction requirement
  IDs, and candidate-selection evidence.

Unknown top-level and observation fields are rejected. Observation counts are
non-negative bounded integers. Candidate-selection evidence is fail-closed:
unknown or unselected mapped candidates, unknown selected IDs, missing claim
mappings, and the absence of an unselected known candidate cannot produce an
isolation pass.

The result contains only `scenarioId`, `status`, and an ordered, deduplicated
`reasonCodes` array. Status is exactly one of `pass`, `blocked`, or
`pass-with-isolation`. Results never copy artifact, requirement, claim,
candidate, conflict, source text, or source identifiers. The optional
`assertSyntheticScenarioExpectation` helper compares this bounded projection
and throws when the expected status or reason set is wrong.

## Provider-free boundary

The runner is synchronous and imports only local evaluation contracts. Its
input has no provider, callback, URL, endpoint, fetch, or network field. A
provider-shaped unknown field is rejected before its value can be invoked.
Synthetic fixtures belong in the focused evaluation tests and must remain
sanitized: no real candidate, employer, opportunity, credential, URL, or
provider response belongs in this preflight.

## Evidence limitation

This preflight is implementation evidence for deterministic trust checks. A
passing matrix does not demonstrate the product outcome on a real application,
and it does not replace a consented workflow comparison. In particular, it
cannot close [issue #249](https://github.com/akoita/draft-loop/issues/249),
which requires one consented v0.9 workflow-parity result using representative
material and the private comparison gate. Synthetic success must therefore
remain separate from Validated or Released outcome evidence.
