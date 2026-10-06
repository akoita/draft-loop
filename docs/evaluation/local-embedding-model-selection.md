# Local embedding model selection

This spike chose the model and runtime for local semantic retrieval
([ADR 0009](../adr/0009-local-semantic-retrieval.md), #914). It is a selection
probe, not evidence of retrieval quality on real CVs. That comparison is #919.

## Result

| Option | License | Download | ms/chunk | Peak RSS | recall@3 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| BM25 (current) | n/a | 0 | ~0 | n/a | 0.16 | 0.29 |
| Granite 97M multilingual R2, int8 | Apache-2.0 | 98 MB | 16 | 532 MB | 0.81 | 0.76 |
| Granite 311M multilingual R2, int8 | Apache-2.0 | 313 MB | 84 | 837 MB | 0.92 | 0.81 |
| harrier-oss-v1-270m, q4 | MIT, Gemma 3 derived | 205 MB | 85 | 562 MB | 0.82 | 0.59 |
| EmbeddingGemma 1 (300M), q4 | Gemma terms | 197 MB | 103 | 597 MB | 0.79 | 0.91 |
| EmbeddingGemma 2 text (270M), Q8 GGUF | Apache-2.0 | 310 MB | ~270 | ~985 MB | 0.86 | 0.96 |

**Decision:** Granite R2, with 311M as the default tier and 97M as the
low-resource tier. Granite combines strong recall, the fastest CPU inference,
permissive licensing, and a released ONNX runtime.

## Reading the result

- **Embeddings versus keywords.** Every embedding model found about five times
  more relevant passages than BM25 in the top three.
- **Model ranking.** With 14 queries, one query moves a metric by about seven
  points, so differences between models are mostly noise.
- **Speed and memory.** These differences are large and decisive for CPU-only
  laptops.
- **Hybrid.** RRF with BM25 scored below dense retrieval on every model here
  because BM25 matched almost nothing. Real CVs share more words with job ads,
  so #919 must measure hybrid against the existing lexical corpus before any
  default changes.

## Method

- **Corpus.** Sixteen invented English and French CV-style chunks and fourteen
  job-requirement queries, written so that most relevant passages share few
  words with the query. Recall@3 and MRR use hand-labelled relevant chunks.
- **Hardware.** x86-64 Linux (WSL2), CPU only, four inference threads.
- **Runtimes.** ONNX models ran through transformers.js 4.3.1 and
  onnxruntime-node 1.30.0. EmbeddingGemma 2 ran through llama.cpp built from
  master at `4625240`, because no released runtime supported it.
- **Prompts.** Each model's documented retrieval prompts were used. Granite
  needs none.
- **Throughput.** Measured on sixty synthetic chunks of about ninety words.
  Peak RSS includes the Node or llama.cpp process.

## Runtime findings

- `node-llama-cpp` 3.22.1 fails on EmbeddingGemma 2 with
  `unknown model architecture: 'gemma-embedding2'`. llama.cpp support merged on
  2026-10-06 (ggml-org/llama.cpp#30054). Re-evaluation is tracked in #923.
- `@huggingface/transformers` depends on `sharp` and libvips (LGPL-3.0), which
  the license policy rejects. The adapter should use `onnxruntime-node` with
  `@huggingface/tokenizers` directly.
- The `onnxruntime-node` package bundles every platform plus CUDA and TensorRT
  libraries (548 MB installed). The CPU runtime for one platform is about
  25–90 MB, so packaging must prune it (#922).
- Qwen3-Embedding-0.6B loaded in node-llama-cpp but ranked poorly without
  model-specific pooling and end-of-sequence handling, and it is twice the size.
  It was not pursued.
