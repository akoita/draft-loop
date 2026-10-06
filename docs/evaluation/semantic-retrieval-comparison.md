# Semantic retrieval comparison

This note records the first comparison of production lexical retrieval with
real local embeddings (#919). It feeds the #114 enable, revise, or reject
decision. The model and runtime choice is in
[ADR 0009](../adr/0009-local-semantic-retrieval.md).

## Decision

**Revise.** Lexical retrieval stays the default for now.

- **Default tier:** Granite 311M at 768 dimensions. It had the best recall and
  ranking.
- **Recall gain:** semantic retrieval far outperforms BM25 on paraphrased,
  cross-language, and synonym requirements.
- **Precision regression:** without a floor, semantic and hybrid modes always
  fill every result slot, so lexical-friendly queries gain irrelevant context.
- **Relevance floor (#926):** the pinned floor below removes the regression on
  the lexical-guard cases and keeps the recall gain. Choosing a non-lexical
  default remains the #114 decision.

## Results

Each mode returns at most three chunks per query. Citation accuracy and
irrelevant context measure precision; unsupported claims is the mean per case.

### Semantic fixture

Sixteen invented cases: six paraphrase, four French/English cross-language,
three synonym or abbreviation, and three exact-term cases, over 25 chunks with
distractors.

| Mode | Recall | MRR | Citation accuracy | Coverage | Irrelevant context | Unsupported claims |
| --- | --- | --- | --- | --- | --- | --- |
| Lexical (BM25) | 0.375 | 0.313 | 0.281 | 0.375 | 0.719 | 0.625 |
| Semantic, 311M 768-d | **0.969** | **1.000** | 0.333 | 0.438 | 0.667 | **0** |
| Hybrid, 311M 768-d | 1.000 | 0.667 | 0.354 | 0.438 | 0.646 | 0 |
| Semantic, 311M 256-d | 0.969 | 0.969 | 0.333 | 0.375 | 0.667 | 0 |
| Hybrid, 311M 256-d | 0.938 | 0.625 | 0.333 | 0.438 | 0.667 | 0.063 |
| Semantic, 97M | 0.938 | 0.844 | 0.333 | 0.313 | 0.667 | 0.063 |
| Hybrid, 97M | 0.750 | 0.521 | 0.271 | 0.375 | 0.729 | 0.250 |

### Lexical-guard fixture

The unchanged three-case corpus from #418 and #422, where exact technical terms
match.

| Mode | Recall | MRR | Citation accuracy | Irrelevant context |
| --- | --- | --- | --- | --- |
| Lexical (BM25) | 1.000 | 1.000 | 1.000 | 0.000 |
| Semantic or hybrid, every tier | 1.000 | 1.000 | 0.333 | 0.667 |

BM25 returns only matching chunks. Semantic and hybrid return three chunks,
including two unrelated ones, which fails the citation-accuracy gate.

### Cost

Measured on x86-64 Linux (WSL2), CPU only, four inference threads.

| Tier | Mean query time | Process RSS |
| --- | --- | --- |
| 311M, 768-d | 14 ms | ~880 MB |
| 311M, 256-d | 10 ms | ~880 MB |
| 97M | 4 ms | ~525 MB |

Embedding the 25-chunk corpus took 105–250 ms.

## Relevance floor

Semantic hits now pass a deterministic floor before truncation to the limit. A
hit is kept when its cosine score is within `maxMarginFromTop` of the best hit
and at least `minimumScore`. In hybrid mode lexical hits always join the fusion,
while semantic-only hits join only above the floor. The values are pinned per
tier in `@draft-loop/embeddings` (`defaultSemanticRelevanceFloor`) and recorded
in the comparison report and the engine result.

| Tier | `maxMarginFromTop` | `minimumScore` |
| --- | --- | --- |
| 311M, 768-d | 0.05 | 0.80 |
| 97M | 0.05 | 0.75 |

The floor applies only at a tier's native dimensions. Truncated vectors and
unknown models run without one.

### Calibration

The sweep covered margins 0.02 to 0.15 and minimums 0.3 to 0.7, with the same
three-chunk limit.

- **Margin does the work.** On the lexical-guard cases the best hit scores
  0.95 to 0.98 (311M) or 0.90 to 0.95 (97M), and the next hit trails it by at
  least 0.12 or 0.17. A margin of 0.10 or less restores lexical precision on
  both tiers. At 0.15 the 311M tier fell back to citation accuracy 0.78.
- **Margin trades precision for recall on 97M.** On the semantic fixture a 0.02
  margin cut 97M semantic recall from 0.938 to 0.875, and 0.03 keeps it. The
  311M tier kept recall 0.969 at every margin.
- **Chosen margin.** 0.05 leaves headroom on both sides: about 0.07 below the
  311M guard gap (0.119) and 0.02 above the 0.03 margin where 97M recall is
  intact.
- **Minimums from 0.3 to 0.7 changed nothing** on either fixture, because every
  relevant query scored above them. Eight invented off-topic queries scored at
  most 0.796 (311M) and 0.746 (97M) against the lowest relevant top scores of
  0.828 and 0.770. The minimums sit between those two bands, so an off-topic
  query returns no semantic hit. That band is narrow and rests on a small
  sample, so revisit it with real career material.

| Margin | 311M guard citation | 311M semantic-fixture citation (semantic / hybrid) | 97M semantic recall |
| --- | --- | --- | --- |
| none | 0.333 | 0.333 / 0.354 | 0.938 |
| 0.02 | 1.000 | 0.78 / 0.49 | 0.875 |
| 0.03 | 1.000 | 0.69 / 0.49 | 0.938 |
| 0.05 | 1.000 | 0.59 / 0.48 | 0.938 |
| 0.08 | 1.000 | 0.50 / 0.48 | 0.938 |
| 0.10 | 1.000 | 0.46 / 0.48 | 0.938 |
| 0.15 | 0.78 | 0.35 / 0.37 | 0.938 |

### Result with the pinned floor

Measured on x86-64 Linux (WSL2), CPU only, four inference threads. Limit three.

| Fixture and mode | Recall | MRR | Citation accuracy | Irrelevant context | Unsupported claims |
| --- | --- | --- | --- | --- | --- |
| Guard, lexical | 1.000 | 1.000 | 1.000 | 0.000 | 0 |
| Guard, semantic or hybrid, both tiers | 1.000 | 1.000 | 1.000 | 0.000 | 0 |
| Semantic fixture, lexical | 0.375 | 0.312 | 0.281 | 0.719 | 0.625 |
| Semantic fixture, semantic 311M | 0.969 | 1.000 | 0.594 | 0.406 | 0 |
| Semantic fixture, hybrid 311M | 1.000 | 0.677 | 0.479 | 0.521 | 0 |
| Semantic fixture, semantic 97M | 0.938 | 0.844 | 0.562 | 0.438 | 0.063 |
| Semantic fixture, hybrid 97M | 0.750 | 0.552 | 0.406 | 0.594 | 0.250 |

The guard fixture no longer regresses against lexical, recall on the semantic
fixture is unchanged, and unsupported claims did not rise. Precision on the
semantic fixture also improved over the unfloored rows above, but hybrid mode
still carries lexical noise, and 97M hybrid recall is unchanged at 0.750.

## Reading the result

- **Recall.** On requirement wording that differs from the evidence, semantic
  retrieval finds nearly every relevant chunk and ranks it first. BM25 finds
  three in eight.
- **Unsupported claims.** The rate falls to zero with the 311M tier.
- **Hybrid ranking.** RRF lowers MRR against semantic alone, because the
  lexical side contributes noise. In this harness that includes BM25's bounded
  fallback chunks for queries with no lexical match, which the production
  hybrid engine leaves out of fusion.
- **Tiers.** At 256 dimensions the 311M tier keeps recall and loses little
  ranking quality. The 97M tier is weaker, especially in hybrid mode, so it
  stays the low-resource option.
- **Limits.** The fixtures are small and invented, so differences of one case
  (about 0.06) are noise. The recall gap and the precision regression are
  consistent across every configuration.

## Reproduce

Point the opt-in test at a directory holding the pinned model files from the
`@draft-loop/embeddings` manifest:

```bash
DRAFT_LOOP_EMBEDDING_MODEL_DIR=<model-dir> DRAFT_LOOP_EMBEDDING_TIER=311m DRAFT_LOOP_EMBEDDING_DIMENSIONS=768 DRAFT_LOOP_RETRIEVAL_REPORT_PATH=<report.json> pnpm vitest run packages/evaluations/src/semantic-retrieval.model.test.ts
```

The test applies the pinned floor for the tier and asserts the criteria above.
The JSON report is content-free. It contains the embedding identity, the applied
floor, metrics, deltas, and timings, but no query or chunk text.
