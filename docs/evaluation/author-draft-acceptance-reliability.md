# Author-draft acceptance reliability

The provider-free author-draft acceptance stage is in progress. Its frozen
six-case replay baseline records two accepted cases and four rejected cases.
It establishes a correction target without changing validation rules or
claiming live-model or real-application quality.

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

The supported paraphrase remains rejected intentionally at baseline. A later
bounded correction may accept that case only if changed quantities and every
other negative control remain rejected.
