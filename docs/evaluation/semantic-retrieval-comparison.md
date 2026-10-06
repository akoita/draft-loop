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
- **EmbeddingGemma 2 (#923):** evaluated against Granite 311M and offered as an
  optional experimental tier; see [EmbeddingGemma 2](#embeddinggemma-2).

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

## EmbeddingGemma 2

This section records the #923 evaluation of the text model in
[`onnx-community/embeddinggemma-2-ONNX`](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX)
(Apache-2.0, pinned revision `daa72c5`) against Granite 311M. It uses the same
fixtures, three-chunk limit, floor method, and hardware as above.

### Recommendation

**Offer it as an optional, experimental tier (`eg2-text`). Keep Granite 311M and
lexical retrieval as the defaults.**

- **Quality.** With its pinned floor it finds every relevant chunk and ranks it
  first, and it cuts irrelevant context on the semantic fixture from 0.41 to
  0.16 against Granite 311M.
- **Cost.** It embeds about 3.4 times slower and queries about 3 times slower
  than Granite 311M. Indexing 1,000 chunks takes about two minutes instead of
  36 seconds.
- **Footprint.** The download is smaller (207 MB against 347 MB) and peak
  memory is similar.
- **Why not the default.** The model is new, its ONNX export is a community
  conversion of a multimodal graph, and sixteen invented cases cannot justify
  moving the default. Revisit with real career material under #114.

### Model files and runtime

The tier pins the 4-bit `model_q4` export. Against the int8 `model_quantized`
export it is 140 MB smaller and answers a single query about three times faster,
with the same quality and per-chunk throughput on these fixtures.

| File | Size (bytes) | SHA-256 |
| --- | --- | --- |
| `onnx/model_q4.onnx` | 490,742 | `f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9` |
| `onnx/model_q4.onnx_data` | 174,028,800 | `c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49` |
| `tokenizer.json` | 32,170,510 | `4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4` |
| `tokenizer_config.json` | 1,599 | `17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874` |

- **External data.** The graph names its weights file by relative path, so both
  files install side by side. `onnxruntime-node` 1.30 loads it from a path.
- **Inputs.** The graph is the multimodal model. Besides `input_ids` and
  `attention_mask` it declares `image_features`, `video_features`, and
  `audio_features`, which the adapter feeds as empty `[0, 512]` float tensors.
- **Outputs.** `last_hidden_state` is `[batch, sequence, 768]` and
  `sentence_embedding` is `[batch, 768]`. The adapter mean-pools
  `last_hidden_state` over the attention mask, which reproduced
  `sentence_embedding` to a cosine of 1.0, then truncates and renormalizes for
  Matryoshka dimensions (768, 512, 256, 128).
- **Prompts.** Queries start with `task: search result | query:` and documents
  with `title: none | text:`, each followed by one space. The tokenizer adds
  `<bos>` and `<eos>`.

### EmbeddingGemma 2 results

Native 768 dimensions with the pinned floor, limit three. Lexical rows are in
the tables above.

| Fixture and mode | Recall | MRR | Citation accuracy | Irrelevant context | Unsupported claims |
| --- | --- | --- | --- | --- | --- |
| Semantic fixture, semantic, 311M | 0.969 | 1.000 | 0.594 | 0.406 | 0 |
| Semantic fixture, semantic, EG2 q4 | **1.000** | **1.000** | **0.844** | **0.156** | 0 |
| Semantic fixture, semantic, EG2 int8 | 1.000 | 0.969 | 0.875 | 0.125 | 0 |
| Semantic fixture, hybrid, 311M | 1.000 | 0.677 | 0.479 | 0.521 | 0 |
| Semantic fixture, hybrid, EG2 q4 | 1.000 | 0.688 | 0.510 | 0.490 | 0 |
| Semantic fixture, hybrid, EG2 int8 | 0.938 | 0.656 | 0.490 | 0.510 | 0.063 |
| Guard, semantic or hybrid, all three | 1.000 | 1.000 | 1.000 | 0.000 | 0 |

At 256 dimensions the floor does not apply. Without it, EG2 q4 keeps recall 1.000
and MRR 1.000 (semantic) against 0.969 and 0.969 for Granite 311M, and both
return irrelevant context on the guard fixture (citation accuracy 0.333).

### EmbeddingGemma 2 floor

The sweep repeated the margins 0.02 to 0.15 and minimums 0 to 0.7 from the
Granite calibration, on the q4 export.

- **Pinned floor:** `maxMarginFromTop` 0.05 and `minimumScore` 0.68.
- **Margin.** Every margin from 0.02 to 0.10 restores lexical precision on the
  guard cases, where the next hit trails the best by at least 0.145. Recall on
  the semantic fixture drops from 1.000 to 0.969 at 0.03 and below, so 0.05 keeps
  the same 0.02 headroom as the Granite tiers.
- **Minimum.** Eight off-topic queries scored at most 0.643, and the weakest
  relevant top score was 0.717. The minimum 0.68 sits in that gap, which is
  about 0.04 on each side. Granite 311M's gap is about 0.03 wide, so the EG2
  floor is less brittle, although the sample is still small.
- **Unsupported claims** stay at zero and the guard cases show no regression.

### EmbeddingGemma 2 cost

Same machine, CPU only, four inference threads, batches of eight. Throughput
embeds 120 synthetic chunks of about 90 words; memory is the process peak.

| Tier | Download | ms per chunk | Single query | Peak RSS |
| --- | --- | --- | --- | --- |
| Granite 311M | 347 MB | 36 | 10 ms | ~910 MB |
| EG2 q4 | 207 MB | 124 | 33 ms | ~810 MB |
| EG2 int8 | 346 MB | 130 | 101 ms | ~895 MB |

The int8 export is slower per query and is not pinned. Batches of 32 did not
help it (130 ms per chunk, 1.18 GB peak).

## Reproduce

Point the opt-in test at a directory holding the pinned model files from the
`@draft-loop/embeddings` manifest:

```bash
DRAFT_LOOP_EMBEDDING_MODEL_DIR=<model-dir> DRAFT_LOOP_EMBEDDING_TIER=311m DRAFT_LOOP_EMBEDDING_DIMENSIONS=768 DRAFT_LOOP_RETRIEVAL_REPORT_PATH=<report.json> pnpm vitest run packages/evaluations/src/semantic-retrieval.model.test.ts
```

`DRAFT_LOOP_EMBEDDING_TIER` also accepts `97m` and `eg2-text`. The test applies
the pinned floor for the tier and asserts the criteria above.
The JSON report is content-free. It contains the embedding identity, the applied
floor, metrics, deltas, and timings, but no query or chunk text.
