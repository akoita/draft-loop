# ADR 0003: Evidence-grounded evaluator–optimizer loop

- Status: Accepted
- Date: 2026-08-13
- Decision owners: DraftLoop maintainers

## Context

DraftLoop was inspired by the evaluator–optimizer pattern: one model produces
an initial result, another evaluates it against a rubric, and the first model
revises it until the quality criteria are met or a retry limit is reached.

A CV workflow needs a stricter version of that pattern. A fluent draft is not
necessarily a truthful draft, and a model evaluator is not an authority on a
candidate's employment history, credentials, dates, or achievements.

## Decision

Use an evidence-grounded evaluator–optimizer loop with these roles:

1. The author generates a structured artifact from the target job, candidate
   evidence, instructions, and rubric.
2. Deterministic validation checks schema, evidence links, required sections,
   and other mechanically verifiable constraints.
3. An independent critic evaluates the artifact and returns structured,
   actionable findings rather than an untracked replacement document.
4. The author may revise accepted findings within bounded round, cost, and time
   limits.
5. The user resolves findings, approves the artifact, and explicitly exports it
   locally.

The default author/evaluator pair remains cross-company (Anthropic and OpenAI).
Each substantive claim must retain source references, and the run records
provider/model identities, findings, revisions, and user decisions without
storing hidden chain-of-thought.

## Controls and stopping conditions

- Blocking findings prevent approval until resolved or explicitly overridden
  with a user rationale.
- Non-blocking warnings remain visible and are not relabeled as validation.
- The loop stops on stable rubric results, configured limits, provider errors,
  or an explicit user request to review early.
- Budget exhaustion still produces a reviewable best-effort artifact; it does
  not silently discard the run or imply success.
- Human approval is separate from export. Agents cannot publish, submit, or
  send the resulting document.

## Alternatives considered

- **Single-pass generation:** simpler and cheaper, but provides no independent
  challenge and makes unsupported claims harder to detect.
- **Evaluator-only rewriting:** compact, but obscures which feedback was
  accepted and allows the evaluator to silently change facts.
- **Unbounded self-critique:** can improve polish but risks cost runaway,
  oscillating revisions, and optimization against a proxy score.
- **Remote retrieval-first architecture:** deferred until local retrieval and
  provenance behavior establish measurable value.

## Consequences

The architecture gains a clear separation between generation, evaluation,
deterministic checks, revision, and approval. This supports provider diversity,
auditable decisions, and measurable evaluation on real applications.

The workflow requires more state, persistence, and UI explanation than a
single model call. Quality still depends on the rubric, evidence quality, and
calibration of the evaluator; the pattern improves the control loop but does
not guarantee truth.
