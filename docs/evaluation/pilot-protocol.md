# Consented outcome pilot protocol

This protocol supports the broader real-application pilot in roadmap rollup
426. The per-case comparison gate was introduced by #248, and #427 adds the
cohort gate required before a broader outcome can pass. The protocol is
deliberately split into a private record and a sanitized report: the private
record may identify participants and retain local runs, while the repository
report contains only aggregate measures and bounded status values.

## Before the run

1. Record consent, the date, and the permitted reporting scope in a private
   location outside the repository. `private-only` is sufficient for a local
   validation; `anonymized-public` is required before publishing anonymized
   measures.
2. Keep the candidate files, job description, workspace database, provider
   responses, credentials, and exported CV outside the repository and outside
   CI artifacts.
3. Confirm the provider transmission preflight, provider/model identities,
   retention choice, budget, and explicit acknowledgement before a live run.
4. Use a representative application and record whether a manual baseline is
   available. Do not replace a missing baseline with a synthetic fixture.
5. Before the first case creates a first draft, declare the private v1 cohort
   gate described below. After each participant consents and before that case
   creates its first draft, declare its private v1 comparison gate.

## Private cohort gate

Every broader real-outcome case file passed to the harness with
`requireOutcome: true` must use an envelope containing `cases` and one
`cohortDeclaration`. The v1 declaration records `schemaVersion: 1`,
`declaredAt`, and a bounded `minimumCaseCount` greater than one. The declaration
must precede every first-draft timestamp. Missing, late, unsupported, malformed,
or extra declaration fields fail before draft comparison.

The v1 decision is fixed. A cohort passes only when it meets its predeclared
minimum size, every per-case comparison gate passes, every counted outcome
records approval and export completion, factuality does not regress, aggregate
revised-draft quality improves over first drafts, and measured review effort is
lower than the candidate-authored manual baselines. A single case cannot pass
the broader pilot. The sanitized report exposes only `pass`, `fail`, or
`indeterminate` and fixed reason codes; it does not expose the declaration,
case identifiers, timestamps, thresholds, or private inputs.

## Private comparison gate

Every real-outcome case passed to the harness with `requireOutcome: true` must
carry a complete, versioned `comparisonGate` and its private
`comparisonMeasurements`. The v1 gate records `schemaVersion: 1`, `declaredAt`,
and thresholds for minimum relevant-achievement recall, minimum
critical-requirement coverage, maximum revised review minutes, and maximum
revised edit count. Thresholds are bounded and are fixed before the first
draft; they are not tuned after seeing the variants.

Factual-invariant violations and unsupported model-added claims are fixed
zero-tolerance checks, not configurable allowances. Required-section
preservation, chronology preservation, and professional readiness are also
mandatory dimensions. The private measurements record the factual-invariant
violation count, required-sections-preserved flag, chronology-preserved flag,
and relevant-achievement recall. The harness validates strict ISO timestamps
and requires `consentedAt <= declaredAt <= firstDraft.createdAt`.

## Outcome record

Record the content-free `PilotOutcomeRecord` after the user has reviewed the
result. The fields are intentionally limited to completion, counts, cost,
confidence, bounded adversarial observations, and structured limitations. The
gate and comparison measurements remain in the private case file:

- approval and export completion, including the formats that were actually
  exported;
- author–critic rounds and provider-reported cost, or `null` when unavailable;
- user confidence on a 1–5 scale, or `null` when not collected;
- whether misleading evidence or prompt injection was observed, not observed,
  or not tested; and
- every limitation that applies, including a single-case sample or an
  unavailable cost, confidence, or adversarial observation.

Assemble the private case-file envelope outside the repository, then run:

```text
pnpm --filter @draft-loop/cli start pilot-report <private-case-file> [output.md]
```

The command refuses a case file that sits inside any git repository, because
that file carries the drafts and the manual baseline. It runs
`runConsentedPilotHarness(cases, { requireOutcome: true })` and writes only the
generated Markdown summary; nothing from the case file reaches the output.

Omitting `[output.md]` writes `pilot-report.md` beside the case file, which the
command has already proven sits outside any repository. An explicit path is
honoured exactly as given, including one inside the repository.

The harness also computes critical-requirement coverage and deterministic
unsupported-claim counts for the first draft, revised draft, and manual
baseline. These are signals for the review, not truth proofs.

The sanitized summary exposes only the comparison-gate overall status and the
`pass`, `fail`, or `indeterminate` status for each named dimension: factual
safety, required-section preservation, chronology preservation,
relevant-achievement recall, critical-requirement coverage, bounded human
review, and professional readiness. It does not expose `declaredAt`, private
thresholds, private measurements, candidate identifiers, draft content, or
paths.

Each case supplies `context`, `firstDraft`, `revisedDraft`, and
`manualBaseline` as draft artifacts, plus the consent, outcome, gate, and
private measurement records. The manual baseline is authored by the candidate
rather than parsed from a document, so the candidate controls exactly what it
asserts.

## Reporting and decision gate

Commit only the generated Markdown summary when its source case is permitted
for anonymized reporting. The summary must not contain candidate identifiers,
source paths, claim text, evidence excerpts, prompts, provider responses,
credentials, employer names, or free-form private notes.

Do not call the stage validated when the report is `INDETERMINATE`, when any
comparison-gate dimension fails or is indeterminate, when approval or export
is incomplete, or when the sample is only synthetic. A passing cohort report
supports only the bounded sample it contains; it does not prove generalization.
Record the remaining limitations and the next decision in `docs/roadmap.md`
and the stage evidence before preparing any release.
