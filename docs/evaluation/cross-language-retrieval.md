# Cross-language retrieval

This note answers one question for the maintainer deciding French retrieval
work (#2332): how well is French evidence found for an English job, and the
reverse? It uses invented bilingual fixtures and local retrieval only, with no
model provider.

## Result

- **Lexical retrieval does not cross languages.** It finds 40% of the right
  evidence across a language boundary, against 100% in the same language. The
  hits come only from words both languages share, such as "cloud" or
  "migration".
- **Stemming would not close that gap.** Same-language lexical recall is already
  complete on these requirements, and stemming cannot map a French word to an
  English one. No stemming issue is filed.
- **Semantic and hybrid recall are pending a model run.** This container cannot
  download the embedding model. Run the command in
  [Reproduce](#reproduce) and fill the table below.

## Fixture

[`cross-language-cases.json`](../../packages/evaluations/fixtures/retrieval-quality/cross-language-cases.json)
describes one fictional candidate. It has 14 evidence chunks, 4 of them
distractors, and 10 job requirements. Every chunk and requirement exists in
English and French with the same meaning, so all four language pairs share one
ground truth.

```mermaid
flowchart LR
  F[Bilingual fixture] --> EE[English evidence, English job]
  F --> FF[French evidence, French job]
  F --> FE[French evidence, English job]
  F --> EF[English evidence, French job]
  FE -. compared with .-> FF
  EF -. compared with .-> EE
```

Each cross-language pair is compared with the same-language pair that shares its
evidence language. The proposed margin is a recall drop of at most 0.10 in the
same retrieval mode (`crossLanguageRecallMargin`).

## Recall

Each mode returns at most three chunks per requirement.

| Pair | Lexical (BM25) | Semantic, 311M | Hybrid, 311M |
| --- | --- | --- | --- |
| English evidence, English job | 1.00 | pending | pending |
| French evidence, French job | 1.00 | pending | pending |
| French evidence, English job | 0.40 | pending | pending |
| English evidence, French job | 0.40 | pending | pending |

The earlier [semantic retrieval comparison](semantic-retrieval-comparison.md)
had four French and English cross-language cases among sixteen. Semantic
retrieval with Granite 311M reached 0.969 recall on that whole fixture.

## Reproduce

You need the repository installed and the Granite 311M model files at the
manifest's pinned revision. See
[local embedding model selection](local-embedding-model-selection.md) for the
files.

The lexical numbers run in every test pass:

```sh
pnpm vitest run packages/evaluations/src/cross-language-retrieval.test.ts
```

For semantic and hybrid recall, point the test at the model directory. It writes
a content-free JSON report with every metric and the per-pair comparison:

```sh
DRAFT_LOOP_EMBEDDING_MODEL_DIR="$HOME/models/granite-311m" \
DRAFT_LOOP_EMBEDDING_TIER=311m \
DRAFT_LOOP_RETRIEVAL_REPORT_PATH="$PWD/cross-language-report.json" \
pnpm vitest run packages/evaluations/src/cross-language-retrieval.test.ts
```

Expected result: three tests pass and `cross-language-report.json` exists. If
the model test is skipped, the model directory variable is empty. If the lexical
test fails, the fixture or the lexical ranking changed: update the table and the
recorded values in the test together.
