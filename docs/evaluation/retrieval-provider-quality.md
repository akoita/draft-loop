# Retrieval and provider quality stage evidence

The retrieval and provider quality stage is complete. It established two
provider-free improvements and made packaged recovery evidence fail closed. It
did not run a live provider, validate a real application outcome, publish a
release, or authorize a new pilot.

## Outcome

The stage met the three exit criteria declared in
[rollup #409](https://github.com/akoita/draft-loop/issues/409):

- Author-validation acceptance on the unchanged three-case sanitized replay
  corpus improved from one of three cases to two of three. The unsupported
  factual-inflation case remains rejected.
- Production lexical retrieval on the unchanged three-query sanitized corpus
  improved citation accuracy from two-thirds to one and reduced irrelevant
  context from one-third to zero. Requirement coverage remained one,
  unsupported claims remained zero, and mean reciprocal rank remained one.
- Cross-platform installed-app acceptance now fails unless its sanitized report
  confirms observable progress, in-flight cancellation, restart resume, and an
  interrupted-run explanation. The strengthened gate passed on Linux x64,
  macOS arm64, and Windows x64.

## Evidence chain

| Evidence | Result |
| --- | --- |
| [#410](https://github.com/akoita/draft-loop/issues/410), [PR #411](https://github.com/akoita/draft-loop/pull/411) | Added strict provider-free replay of private rejected-author capture inputs with content-free results. |
| [#412](https://github.com/akoita/draft-loop/issues/412), [PR #413](https://github.com/akoita/draft-loop/pull/413) | Added bounded deterministic batch summaries without returning case content or identity. |
| [#414](https://github.com/akoita/draft-loop/issues/414), [PR #415](https://github.com/akoita/draft-loop/pull/415) | Recorded the sanitized author-validation baseline: one accepted, two rejected, with one factual-invariant and one coverage diagnostic. |
| [#416](https://github.com/akoita/draft-loop/issues/416), [PR #417](https://github.com/akoita/draft-loop/pull/417) | Improved the unchanged replay corpus to two accepted and one rejected through exact, already-cited coverage completion. |
| [#418](https://github.com/akoita/draft-loop/issues/418), [PR #419](https://github.com/akoita/draft-loop/pull/419) | Recorded that local term-frequency/RRF hybrid retrieval tied the original lexical baseline and did not justify enablement. |
| [#420](https://github.com/akoita/draft-loop/issues/420), [PR #421](https://github.com/akoita/draft-loop/pull/421) | Required packaged progress, cancellation, restart-resume, and interrupted-run evidence across supported targets. |
| [#422](https://github.com/akoita/draft-loop/issues/422), [PR #423](https://github.com/akoita/draft-loop/pull/423) | Improved lexical precision while preserving sparse-query recall, fallback, order, limits, and workspace isolation. Hybrid then failed the comparison gate and remained disabled. |

## Safety and limitations

All author-validation and retrieval measurements use invented local fixtures.
They demonstrate deterministic behavior at the tested boundaries, not general
model quality or a real candidate outcome. Private capture content remains
caller-owned and is not committed or returned by replay summaries.

The packaged evidence uses offline fixture agents. It demonstrates installed
application lifecycle behavior without validating live-provider availability,
latency, billing, or output quality. Hybrid and vector retrieval remain
disabled because the tested candidate did not improve on the lexical baseline.

No v0.9 release exists, and this stage does not create another release. A later
provider-backed pilot requires a new bounded issue, predeclared success and stop
conditions, candidate consent, and explicit authorization for each provider
call.
