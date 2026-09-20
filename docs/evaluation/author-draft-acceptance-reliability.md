# Author-draft acceptance reliability

The provider-free author-draft acceptance stage is in progress. Its unchanged
six-case corpus now records three accepted cases and three rejected cases,
compared with a frozen baseline of two accepted and four rejected. This is a
deterministic validator result, not a claim of live-model or real-application
quality.

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
