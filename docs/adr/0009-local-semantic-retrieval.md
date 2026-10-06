# ADR 0009: Add local semantic retrieval with Granite Embedding R2

- Status: Accepted
- Date: 2026-10-06
- Decision owners: DraftLoop maintainers

## Context

CKB retrieval is lexical only ([ADR 0008](0008-ckb-scoped-lexical-retrieval.md)).
SQLite FTS5/BM25 misses evidence that uses different words from the job
requirement, such as "managed a team" for "people leadership", or a French CV
line for an English requirement. The earlier `vector` and `hybrid` evaluation
modes used a term-frequency stand-in, not a learned embedding model, so semantic
retrieval has never been measured.

Constraints that shape the choice:

- **Local first.** Candidate material and embeddings stay on the user's machine.
- **Modest hardware.** Users run CPU-only laptops; no GPU can be assumed.
- **Desktop packaging.** The runtime must ship on Windows, macOS, and Linux.
- **License policy.** Dependencies and model weights must be permissively
  licensed (`pnpm security:licenses`).
- **Multilingual CVs.** Candidates and opportunities mix languages.

## Decision

### Model

Use IBM [Granite Embedding Multilingual R2][granite]. It is Apache-2.0
licensed, covers 200+ languages, has a 32K-token context, and ships official
ONNX files.

- **Default tier:** `granite-embedding-311m-multilingual-r2`, int8 ONNX
  (313 MB, 768 dimensions, Matryoshka truncation available).
- **Low-resource tier:** `granite-embedding-97m-multilingual-r2`, int8 ONNX
  (98 MB, 384 dimensions).

The [selection spike](../evaluation/local-embedding-model-selection.md) measured
both tiers against EmbeddingGemma 1 and 2, harrier-oss-v1-270m, and BM25 on CPU.
The final default tier and retrieval mode are set by measured evaluation (#919).

### Runtime

Run `onnxruntime-node` with `@huggingface/tokenizers` in a new
`packages/embeddings` package behind a framework-free `TextEmbedder` port.

- Do not depend on `@huggingface/transformers`: it pulls in `sharp` and libvips
  (LGPL-3.0).
- Use CPU only, with bounded threads. Packaged builds exclude GPU provider
  libraries.
- The port is model-agnostic. Another model needs only a new adapter and
  manifest entry.

### Model acquisition

Install the model only on explicit user action. Downloads come from pinned
Hugging Face revisions and are verified with SHA-256 before use. Model files
live in a DraftLoop-owned data directory outside every CKB, workspace, and
backup. Offline install from a local file uses the same verification. No code
path downloads a model implicitly.

### Vector storage

Each CKB store keeps a derived vector projection beside its lexical index.

- Rows reuse the exact-version lexical chunk identity plus the embedding
  identity: model, revision, file SHA-256, and dimensions.
- Vectors are Float32 BLOBs. Search is exact cosine over the selected source
  versions; CKB scale does not justify an ANN index or a SQLite extension.
- An embedding identity change marks the index `stale`. Backups omit vectors,
  and a restore reports `not-indexed`.

### Retrieval

Retrieval mode is `lexical` (default), `semantic`, or `hybrid` (BM25 and vector
rankings fused with RRF per CKB, then the existing cross-CKB fusion).

- When the model or index is unavailable, retrieval falls back to lexical with a
  visible `semantic-unavailable` diagnostic, never silently.
- Traces record mode and embedding identity and stay content-free.
- A non-lexical default requires the measured gains defined in #114.

## Consequences

- Paraphrased and cross-language evidence becomes retrievable without sending
  candidate material anywhere.
- Users download a model of about 100–310 MB once, and indexing costs roughly
  20–90 ms per chunk on four CPU threads.
- Installers grow by the platform's CPU ONNX runtime, about 25–90 MB.
- Vector rows add a second derived projection that every CKB lifecycle
  operation must keep consistent.

## Alternatives considered

### EmbeddingGemma 2

It had the best ranking quality in the spike and is Apache-2.0 licensed. It was
first deferred because no released Node runtime supported it: node-llama-cpp
3.22.1 rejected the architecture. A community ONNX export then made it usable
on the same `onnxruntime-node` runtime.

The #923 evaluation found higher precision than Granite 311M on the invented
fixtures, but indexing was about 3.4 times slower on CPU. It ships as the
optional experimental tier `eg2-text`, and Granite 311M stays the default.

### harrier-oss-v1-270m and EmbeddingGemma 1

harrier-oss-v1-270m has a high leaderboard score, but it is derived from
Gemma 3, so its license provenance is unclear. EmbeddingGemma 1 is distributed
under the Gemma terms of use and is superseded by EmbeddingGemma 2.

### Larger models and cross-encoder rerankers

Qwen3-Embedding-0.6B, harrier 0.6B, and 0.5B+ rerankers need roughly two to
four times the memory, which conflicts with modest hardware. A reranker remains
a possible later add-on.

### Remote embedding APIs or vector databases

Rejected by the local-first rule. Either would need its own architecture and
privacy decision.

### No retrieval: send the whole CKB to the author

Rejected because it widens provider exposure from bounded selected chunks to the
full candidate corpus.

[granite]: https://huggingface.co/blog/ibm-granite/granite-embedding-multilingual-r2
