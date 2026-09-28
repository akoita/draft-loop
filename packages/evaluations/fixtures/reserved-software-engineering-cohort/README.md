# Reserved software-engineering cohort

This directory contains two fully fictional candidate profiles and different
software-engineering opportunities. Each profile has source identifiers,
complete dated work history, supported contact and background details, and
explicit evidence for technical contributions. The expectations files separate
source-backed must-cover facts and prohibited claims from semantic review
questions and deterministic checks.

The profiles are reserved from the #619–#621 implementation work, but were
visible to this fixture author. They are therefore not a fully independent
holdout. After the implementation and review rules are frozen, no tuning may
use these cohort results; any required change needs a separately reviewed
scope decision and a fresh reserved cohort.

The frozen #622 observation was explicitly authorized and run on revision
`c2b3fa3f9acbccbbedfd8ac3d1f253193ecbd816`. Its admission allowed two
ordinary author-and-critic workflows, one round per profile, at most two
Claude Opus 5.5 medium author calls and two GPT-6 Sol low critic calls through
subscription sessions, 40 minutes total, no retries, and no API billing.
Both authentication probes passed, but each author call stopped before model
inference because Claude Code could not refresh its OAuth token while another
process was refreshing it or had exited mid-refresh. The two attempts took
24.6 seconds in total; both reported zero input/output tokens and zero cost.
No draft, claim, critic call, approval, or export occurred. The per-case
results are **indeterminate for CV quality**, and the cohort does not meet its
workflow-completion exit. The private transport records remain local. This
observation must not be counted as a pass or used to tune the frozen fixture.

| Case | Author calls | Critic calls | Duration | Workflow state |
| --- | ---: | ---: | ---: | --- |
| A | 1 | 0 | 11.5 s | Provider error before author inference |
| B | 1 | 0 | 12.3 s | Provider error before author inference |

Schema and grounding admission, draft coverage, unsupported or contradictory
claims, critic findings, and candidate acceptance could not be measured because
neither case produced a draft. The required intervention is to resolve the
subscription-session authentication contention before a separately authorized
observation; accepting warnings cannot substitute for an absent workflow.

Provider-free preflight also exposed retrieval limits before the live calls:
the selected evidence included contact and languages for both profiles, but
omitted the case A training body and both profiles' explicit gap and project
date headings. Because authoring never began, their effect on draft coverage
was not measured. A later run needs a fresh admission and authorization.

All names, organizations, projects, domains, chronology, achievements, and
contact details are invented for this fixture. `.test` addresses are reserved
placeholders. No real candidate material or application outcome is represented.
