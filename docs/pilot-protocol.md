# Consented outcome pilot protocol

This protocol is for the real-application validation gate in roadmap issue
104. It is deliberately split into a private record and a sanitized report:
the private record may identify the participant and retain the local run, while
the repository report contains only aggregate measures and bounded status
values.

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

## Outcome record

Record the content-free `PilotOutcomeRecord` after the user has reviewed the
result. The fields are intentionally limited to completion, counts, cost,
confidence, bounded adversarial observations, and structured limitations:

- approval and export completion, including the formats that were actually
  exported;
- author–critic rounds and provider-reported cost, or `null` when unavailable;
- user confidence on a 1–5 scale, or `null` when not collected;
- whether misleading evidence or prompt injection was observed, not observed,
  or not tested; and
- every limitation that applies, including a single-case sample or an
  unavailable cost, confidence, or adversarial observation.

Assemble the private case file outside the repository, then run:

```text
pnpm --filter @draft-loop/cli start pilot-report <private-case-file> [output.md]
```

The command refuses a case file that sits inside any git repository, because
that file carries the drafts and the manual baseline. It runs
`runConsentedPilotHarness(cases, { requireOutcome: true })` and writes only the
generated Markdown summary; nothing from the case file reaches the output.

The harness also computes critical-requirement coverage and deterministic
unsupported-claim counts for the first draft, revised draft, and manual
baseline. These are signals for the review, not truth proofs.

Each case supplies `context`, `firstDraft`, `revisedDraft`, and
`manualBaseline` as draft artifacts, plus the consent and outcome records. The
manual baseline is authored by the candidate rather than parsed from a
document, so the candidate controls exactly what it asserts.

## Reporting and decision gate

Commit only the generated Markdown summary when its source case is permitted
for anonymized reporting. The summary must not contain candidate identifiers,
source paths, claim text, evidence excerpts, prompts, provider responses,
credentials, employer names, or free-form private notes.

Do not call the stage validated when the report is `INDETERMINATE`, when
approval or export is incomplete, or when the sample is only synthetic. A
passing report supports one consented outcome observation; it does not prove
generalization. Record the remaining limitations and the next decision in
`docs/roadmap.md` and the stage evidence before preparing the release.
