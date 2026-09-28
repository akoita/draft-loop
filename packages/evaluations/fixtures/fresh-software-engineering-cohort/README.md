# Fresh software-engineering cohort

This fixture contains two entirely fictional engineers and distinct software
engineering opportunities. Each profile records a complete dated work history,
including an explicit interval with no listed software role, plus contact,
education, training, skills, and language details where the fictional source
supports them. Source IDs tie the review expectations to exact profile facts.

The profiles were created after the provider and retrieval fixes were merged
and were not used to tune those changes. This is not a blind holdout: the
fixture author saw the corpus while preparing it.
Expectations describe intended source support, not measured model behavior.
No provider run is authorized by these files. Any cohort workflow requires
separate authorization; the planned ceiling is one ordinary author–critic
round per profile and four provider calls total.

## Frozen #630 observation

The separately authorized run used revision
`70927318aa43a3847414607aa98a562093badd22`, Claude Opus 5.5 at medium
effort for authoring, and GPT-6 Sol at low effort for independent review. It
made two author calls and one critic call through subscription sessions in
138.4 seconds, with no retries or API-key billing. Neither fictional CV was
approved, exported, or published. Raw prompts, responses, drafts, and run
records remain private and local.

| Case | Author calls | Critic calls | Duration | Result |
| --- | ---: | ---: | ---: | --- |
| C | 1 | 0 | 58.1 s | Author response rejected by a factual-invariant false positive; no admitted draft or critic result |
| D | 1 | 1 | 79.7 s | Schema/grounding-admitted draft, independent critic with zero findings; explicit employment gap omitted |

Case C's sole rejection named the sentence about a Rust adapter called
Driftglass Bridge. Both cited chunks contain that claim, but wrap the product
name in Markdown emphasis (`Rust **Driftglass Bridge**`). The validator
interpreted the unformatted phrase as one protected name and did not recognize
the equivalent source formatting. This is a lexical validator defect, not
evidence that the author invented the adapter. Because no draft passed the
validator, case C's full coverage and independent review remain unmeasured.

Case D retained separate employer dates, the exact 30-build and 22-to-16-minute
benchmark scope, team and release ownership, prototype maturity, contact,
degree, attendance-only training, and language levels. The draft did not say
that November 2018 to January 2020 was an employment gap, although the source
and frozen `mustCover` expectation expressly require it. Its seven local
uncovered-requirement warnings are token-matching diagnostics; they do not
establish seven semantic omissions. The critic returned no findings and thus
did not catch the gap. No prohibited, contradictory, or unsupported substantive
claim was observed in the admitted case D draft.

The cohort **does not meet** its predeclared two-case workflow and coverage
exit. Case C needs a narrow validator correction; case D needs better gap
coverage or review detection. These observations must not be relabeled as a
generalization pass or used to tune and rerun this frozen cohort. Any further
live evaluation needs a new cohort, admission, and authorization.
