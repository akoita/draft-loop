# Author-draft acceptance reliability

The provider-free author-draft acceptance stage met its predeclared exit. Its
unchanged six-case corpus records three accepted cases and three rejected
cases, compared with a frozen baseline of two accepted and four rejected. This
is a deterministic validator result, not a claim of live-model or
real-application quality.

## Decision

The stage exit is **met**. One supported false rejection moved to acceptance,
all negative controls retained their intended rejection, and the bounded retry
fixture reached an accepted artifact only after receiving all three structural
correction families. No threshold, retry cap, required-section rule,
chronology rule, evidence-ownership rule, or unsupported-claim rule was
weakened.

The result is sufficient to admit a separately gated representative
author-draft revalidation. It does not authorize a provider call, a cohort,
candidate approval, export, release, or application submission.

## Evidence chain

| Issue and PR | Measured outcome |
| --- | --- |
| [#438](https://github.com/akoita/draft-loop/issues/438), [PR #442](https://github.com/akoita/draft-loop/pull/442) | Froze six sanitized cases at two accepted and four rejected, including one supported false rejection and three negative-control families. |
| [#439](https://github.com/akoita/draft-loop/issues/439), [PR #443](https://github.com/akoita/draft-loop/pull/443) | Moved only the evidence-equivalent percentage case to acceptance; changed quantity, unavailable evidence, and uncovered text remained rejected. |
| [#440](https://github.com/akoita/draft-loop/issues/440), [PR #444](https://github.com/akoita/draft-loop/pull/444) | Made factual text, invalid evidence reference, and uncovered text feedback structurally actionable; the deterministic retry fixture then succeeded within the unchanged cap. |

The replay input file SHA-256 is
`13b578342aabff116e72044723cb1102227b77f567adcae46477ceef43187fb2`
at both baseline and final measurement. Only the separate expected-result
manifest changed for the corrected positive case.

## Frozen baseline

The corpus preserves the previous three invented replay cases and adds three
invented controls derived from the structural failure classes observed in the
broader pilot. Every case runs through the production author-artifact validator
without a provider or network interface.

| Structural case | Expected result | Diagnostic family |
| --- | --- | --- |
| Exact supported claim | Accepted | None |
| Changed supported quantity | Rejected | Factual invariant |
| Exact already-cited block coverage | Accepted | None |
| Evidence-equivalent percent paraphrase | Rejected | Factual invariant |
| Unavailable evidence reference | Rejected | Artifact schema |
| Mixed supported and uncovered text | Rejected | Substantive coverage |

The aggregate is six total, two accepted, and four rejected. Rejections contain
three factual-invariant failure stages and one artifact-schema failure stage.
Their fixed diagnostic counts are two factual-invariant violations, one
unavailable-reference schema diagnostic, and one uncovered-substantive-text
diagnostic. Tests also verify each case independently so an unchanged aggregate
cannot conceal a case-level regression.

## Safety and limitations

All source and opportunity material is fictional and local. Replay summaries
contain only bounded counts, failure stages, and diagnostic codes; they exclude
fixture prose and identities. The baseline makes no provider call, changes no
threshold, and does not establish author quality outside these deterministic
fixtures.

The supported paraphrase is intentionally rejected in this frozen baseline.
The correction below changes its result only while every negative control
remains rejected.

## Supported-paraphrase correction

The validator now recognizes only the corpus's bounded percentage spelling
equivalence: a claim using `N%` may cite approved evidence using `N percent`.
The quantity must match exactly. The rule does not normalize dates, employers,
seniority, technologies, scope, unsupported evidence identifiers, or other
wording.

On the unchanged corpus, the declared supported-paraphrase case moves to
accepted. The changed-quantity, unavailable-evidence, and uncovered-text
controls retain their original rejection and diagnostic families. The final
aggregate is three accepted and three rejected, with one factual-invariant,
one artifact-schema, and one substantive-coverage diagnostic. Required-section
and chronology behavior are outside the narrow rule and remain unchanged.

## Structured retry feedback

Author retries now receive bounded, path-scoped corrections for three exact
diagnostic families: unsupported factual claim text, invalid evidence chunk
references, and substantive block text lacking claim coverage. Each correction
uses a fixed instruction and a sanitized proposal path. Unknown codes, unsafe
paths, near-match structures, candidate prose, evidence excerpts, and local
paths are excluded.

A deterministic fixture author first fails with all three diagnostic families.
Its next permitted attempt succeeds only when it receives every structured
correction; absent or incomplete corrections leave the fixture rejected. The
workflow retains the existing retry cap, timeout, cancellation, persistence,
and no-silent-fallback behavior. This provider-free result demonstrates the
contract boundary, not live-model correction quality.

Invented fixtures and deterministic agents do not establish live author
behavior, real-application quality, or reduced candidate effort. The stage did
not run authentication probes or providers and did not use private candidate
material. A representative revalidation requires a new bounded issue with
consent, explicit provider authorization, predeclared acceptance and stop
conditions, and a visible first-review boundary.
