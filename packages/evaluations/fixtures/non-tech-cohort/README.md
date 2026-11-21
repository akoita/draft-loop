# Non-tech cohort baseline

Four fictional candidates outside software: a nurse, an account executive, a
primary teacher and an electrician. Every name, employer, school, PIN and
number is invented. Use these cases to measure whether drafting holds for
roles the engine was not tuned on (rollup #3086).

Run the provider-free checks from the repository root:

```sh
pnpm exec vitest run packages/application/src/non-tech-cohort-baseline.test.ts
```

No model is called. The test compares today's results with
[baseline.json](baseline.json), so a fix that changes a result must rewrite
the baseline in the same PR. Set `DRAFT_LOOP_WRITE_NON_TECH_BASELINE=1` on
the same command to rewrite it.

## Files

| File                                                               | What it checks                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [grounding-cases.json](grounding-cases.json)                       | 20 claims over role vocabulary (NMC, ALS, ICU, MEDDIC, KS2, QTS, JIB, BS 7671), each labelled supported or contradicted |
| [requirement-evidence-cases.json](requirement-evidence-cases.json) | 16 job requirements, 4 per role, labelled against a 26-chunk corpus                                                     |
| [section-evidence-cases.json](section-evidence-cases.json)         | 10 CV lines, each labelled with the required section it supports                                                        |
| [baseline.json](baseline.json)                                     | Today's results, known failures included                                                                                |

## Baseline on 2026-11-21

| Check                                   | Result                                                                                                                     | Follow-up                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Grounding: supported claims rejected    | 0 of 13 since #3089 (3 before: "Advanced Life Support" for ALS, "Key Stage 2" for KS2, "QTS" for Qualified Teacher Status) | Done                                   |
| Grounding: contradicted claims accepted | 3 of 7: "two years" for six months, a crew of "eight" for three, "17th Edition" for 18th                                   | The critic must catch these; see below |
| Retrieval recall                        | Today's picks 0.656, BM25 0.719; both miss ALS, complex deals, Key Stage 2 and special educational needs                   | Semantic arm, #3088                    |
| Required-section evidence               | 10 of 10 lines recognised since #3088 (1 of 10 before)                                                                     | Done                                   |

The section matcher used to recognise an experience line through words such
as "engineer", so a software line passed and a nurse's or teacher's line did
not. Since #3088 it uses role-neutral terms (competencies, registration,
licence, card, placement) and a dated period such as "2021 to present".

Number words ("two", "eight") and ordinals ("17th") are not protected values
today, so a wrong count or edition passes deterministic grounding and only the
critic can catch it.
