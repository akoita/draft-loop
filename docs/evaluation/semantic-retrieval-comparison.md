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
- **Precision regression:** semantic and hybrid modes always fill every result
  slot, so lexical-friendly queries gain irrelevant context. A relevance floor
  (#926) must remove this regression before #114 can choose a non-lexical
  default.

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

## Reading the result

- **Recall.** On requirement wording that differs from the evidence, semantic
  retrieval finds nearly every relevant chunk and ranks it first. BM25 finds
  three in eight.
- **Unsupported claims.** The rate falls to zero with the 311M tier.
- **Hybrid ranking.** RRF lowers MRR against semantic alone, because BM25
  contributes noisy matches. #927 records one cause: BM25 matches stopwords
  such as "and".
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

The JSON report is content-free. It contains the embedding identity, metrics,
deltas, and timings, but no query or chunk text.
