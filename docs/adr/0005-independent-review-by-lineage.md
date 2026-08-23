# ADR 0005: Express independent review by model lineage, not by company

- Status: Accepted
- Date: 2026-08-18
- Decision owners: DraftLoop maintainers

## Context

The product promises independent review: a draft is critiqued by something
other than the model that wrote it. The implementation asserts that promise by
comparing `ModelSelection.company` strings, in `hasProviderDiversity`
(`packages/domain`), in a `superRefine` on `modelConfigurationSchema`
(`packages/schemas`), and in `usesDifferentProviders` (`packages/providers`).

Company is a proxy for independence, and the proxy is wrong in both directions.

It **falsely rejects**: `claude-opus-5` authoring with `claude-haiku-4-5`
critiquing is refused as "same company", though these are different models with
different behaviour.

It **falsely accepts**: two vendors serving the same open-weights base model
produce different company strings, pass the check, and the run is recorded as an
independent critique that was in fact produced by identical weights. This is the
one that matters, because it is silent and it errs toward over-claiming, in a
product whose stated value is traceability.

Local models made the mismatch impossible to ignore. After
[#185](https://github.com/akoita/draft-loop/issues/185) a workspace can run a
local model, and every local model carries the literal company `local`. Two
genuinely different local models are therefore read as one company and refused,
while the question worth asking — "did the same weights write and review this?"
— is exactly as meaningful locally as it is for hosted models.

`docs/roadmap.md` already states the principle and names cross-company as the
_default mechanism_, not the property itself:

> **Independent review**: provider and model identities are visible, and
> cross-company diversity is the default.

The implementation hardcoded the mechanism and dropped the principle.

The two concerns already live on separate fields. Data exposure keys off
`ProviderId` in `assertDataExposureAllowed` — genuinely corporate, since it
governs who receives candidate material. Independence keys off
`ModelSelection.company`. This decision finishes a separation that already
exists rather than introducing one.

## Decision

**Independence is expressed as model lineage.** `ModelSelection` gains an
optional `lineage` field. Two selections are independent when their lineages
differ. When a selection declares no lineage, one is derived from its company
and model id, so existing workspaces keep their current behaviour without
migration.

**A shared lineage blocks the run by default, and the block is overridable with
a recorded rationale.** The rationale is persisted with the run and surfaced at
the approval boundary alongside the author lineage, the critic lineage, and
whether they were actually distinct.

**Independence is recorded on the produced artifact, not only enforced on the
run.** A reader of an approved artifact can see what independence was claimed
and whether it held.

## Rationale

A lineage label is a claim, not a measurement. Nothing in the system can verify
that two labels denote different weights: a user can enter `local-a` and
`local-b` for the same GGUF file and pass the check. That is an argument for
recording and surfacing the claim so a person can judge it, not an argument for
trusting the gate harder.

Blocking by default keeps the safety property that holds today. Making the block
overridable with a recorded rationale keeps the decision with the person, which
is what `docs/roadmap.md` means by "Agents advise; people decide", while leaving
an auditable trace of what they chose and why. A boolean that silently either
refuses a legitimate pairing or misreports a compromised one serves neither.

Deriving a default from company and model id keeps every existing workspace
working and makes the common hosted case require no new input. It also means the
false-reject disappears immediately: `claude-opus-5` and `claude-haiku-4-5`
derive different lineages.

## Consequences

Two different local models can now serve as author and critic, so a workspace
can run without any hosted provider credit.

The false-accept becomes visible rather than silent. Two vendors serving the same
base model can be given the same lineage, and the pairing is then correctly
refused, or proceeds with a recorded rationale.

Independence is no longer inferable from company alone, so any surface that
reported "cross-company" must report lineage instead. Reviewers of existing
evidence should note that runs recorded before this change asserted only
cross-company diversity.

The gate's strength now depends on labels the user controls. A user who wants to
defeat it can, which is why the claim is recorded at the approval boundary rather
than treated as proof.

Override-rationale plumbing did not previously exist in the codebase. This
decision introduces it rather than wiring up an earlier implementation.

## Follow-up

- Surface author lineage, critic lineage, distinctness, and any recorded
  override rationale in the desktop approval view and in CLI status output.
- Decide whether known hosted models should ship with curated lineage defaults,
  which would catch two vendors serving one base model without user input.
- Revisit whether `usesDifferentProviders` in `packages/providers` still has a
  caller, or is now redundant with the lineage comparison.
