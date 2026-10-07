# Semantic requirement coverage

This note records the #727 investigation into why deterministic coverage
rejects concise, evidence-backed CV wording, and proposes a replacement
contract. It uses invented material only.

## Finding

- **The current rule rejects every differently worded match.** A requirement
  counts as covered only when half of its meaningful words appear in one CV
  block. All seven covered requirements that use different wording, spread
  across blocks, or are written in another language were reported uncovered.
- **Embedding similarity cannot decide coverage on its own.** Misleading keyword
  neighbours and genuine gaps score as high as true matches, so no threshold
  separates them safely.
- **Embedding similarity does find the right evidence.** The top-ranked block
  was a correct evidence block for 7 of 7 covered requirements with
  EmbeddingGemma 2 and 6 of 7 with Granite 311M.
- **A protected rule had a gap.** "MSc or PhD in Computer Science" fell outside
  the strict degree grammar, so word overlap accepted a block that states only a
  BSc. #950 fixed this.

Embeddings should therefore propose evidence, and a judge should decide. The
deterministic protections must keep deciding degrees, organisation maturity,
dates, and metrics.

## Fixture

The fixture is at
[`semantic-coverage-cases.json`](../../packages/evaluations/fixtures/requirement-coverage/semantic-coverage-cases.json).
It has fourteen invented CV blocks and sixteen requirements. Every label and
evidence block was written before any matcher ran.

| Kind | Requirements | Expected |
| --- | --- | --- |
| Paraphrase | r1, r2, r3, r7 | Covered |
| Spread across blocks | r4, r5 | Covered |
| Cross-language (French block) | r6 | Covered |
| Exact terms | r15, r16 | Covered |
| Genuine gap | r8, r9, r10 | Uncovered |
| Misleading keyword neighbour | r11, r12 | Uncovered |
| Protected degree | r13 | Uncovered |
| Protected organisation maturity | r14 | Uncovered |

`semantic-requirement-coverage.test.ts` reproduces the deterministic results.
Its assertions record current behaviour, so update them when the rule changes.

## Results

### Deterministic rule

| Outcome | Requirements |
| --- | --- |
| Correctly covered | r15, r16 |
| False negative | r1, r2, r3, r4, r5, r6, r7 |
| Correctly uncovered | r8, r9, r10, r11, r12, r13, r14 |

Before #950, r13 was a false positive: the strict degree grammar did not
recognise "MSc or PhD in Computer Science", so word overlap accepted a BSc.

### Embedding similarity

Each requirement was embedded as a query and compared with every block. The
table shows the best block score. Measured on CPU with the pinned Granite 311M
and EmbeddingGemma 2 (q4) tiers.

| Requirement | Expected | Granite 311M | EmbeddingGemma 2 |
| --- | --- | --- | --- |
| r1 people management | Covered | 0.890 | 0.786 |
| r2 cloud cost | Covered | 0.881 | 0.821 |
| r3 resilience | Covered | 0.848 | 0.765 |
| r4 monolith to Kubernetes | Covered | 0.910 | 0.814 |
| r5 management and mentoring | Covered | 0.888 | 0.805 |
| r6 workshops (French block) | Covered | 0.873 | 0.809 |
| r7 strategy to leadership | Covered | 0.831 (wrong block) | 0.744 |
| r8 production ML | Gap | 0.836 | 0.742 |
| r9 German fluency | Gap | 0.787 | 0.641 |
| r10 mobile apps | Gap | 0.851 | 0.666 |
| r11 teaching Python to engineers | Misleading | 0.867 | 0.753 |
| r12 ML engineering in production | Misleading | 0.865 | 0.740 |

- **Granite 311M overlaps completely.** The misleading r11 (0.867) and the gap
  r10 (0.851) both outscore the covered r7 (0.831), whose best block is the
  wrong one.
- **EmbeddingGemma 2 separates by about 0.01.** The misleading r11 scores 0.753
  against 0.765 for the weakest covered paraphrase, and r7 falls to 0.744. A
  margin this thin cannot gate readiness.
- **Clause-level matching did not help.** Splitting compound requirements and
  matching each clause anywhere made the spread cases pass, but gaps and
  misleading clauses still found high-scoring neighbours.

## Proposed validation contract

Each requirement gets one assessment. The assessment is provider-independent,
content-free beyond block identifiers, and stored with the run.

| Field | Values |
| --- | --- |
| `status` | `covered`, `needs-judgement`, `uncovered`, or `explicit-gap` |
| `basis` | `lexical`, `protected-rule`, `semantic-candidate`, or `judgement` |
| `evidence` | Up to three block identifiers, with a similarity score for semantic candidates |
| `rationale` | A short user-visible sentence; never hidden reasoning |

The rules apply in order:

1. **Protected rules decide alone.** Degree, organisation-maturity, and future
   date or metric rules are deterministic. Semantic evidence never overrides
   them, and a failure is `uncovered` with basis `protected-rule`.
2. **Lexical coverage stays.** A requirement covered today stays `covered` with
   basis `lexical`.
3. **Semantic candidates need judgement.** A lexically uncovered requirement
   whose best block passes the tier's relevance floor becomes `needs-judgement`.
   It carries the candidate blocks. Severity is unchanged until judged, so a
   critical requirement still blocks readiness.
4. **A judge decides.** The critic receives each `needs-judgement` requirement
   with its candidate blocks and returns `satisfied` or `not-satisfied`, citing
   block identifiers and a short rationale. `satisfied` becomes `covered` with
   basis `judgement`; `not-satisfied` becomes `uncovered`.
5. **No model, no change.** Without an installed embedding model, assessments
   match today's behaviour, and the run says semantic candidates were not
   available.

This works across jobs and languages: it adds no job-specific vocabulary, and
the cross-language case is handled by the multilingual embedder plus the judge.

## Implementation units

The units are ordered, and each is one PR:

1. **Degree-level grammar.** Recognise "<level> [or <level>] in <subject>"
   requirements in the strict degree rule, so a lower degree never satisfies a
   higher one (#950).
2. **Assessment contract.** Return a requirement-level assessment from
   validation with `status`, `basis`, `evidence`, and `rationale`, while keeping
   existing issue codes and severities unchanged (#951).
3. **Semantic candidates.** Use the local embedder and the workspace tier to
   attach candidate evidence to lexically uncovered, non-protected requirements
   as `needs-judgement` (#952).
4. **Critic judgement.** Add a provider-independent judgement port so the critic
   resolves `needs-judgement` requirements with cited blocks and a rationale
   (#953).
5. **Readiness and display.** Count judged coverage in readiness, and show the
   requirement-level rationale in the CLI and desktop (#954).

## Limits

- **Small invented sample.** The fixture has one candidate and sixteen
  requirements. The finding that embeddings cannot gate coverage is robust,
  because the score bands overlap; the exact margins are not.
- **Judge quality is untested.** Unit 4 must be evaluated on this fixture before
  readiness relies on it.
