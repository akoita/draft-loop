# ADR 0010: A workspace is the candidate's home, with many applications

- Status: Accepted
- Date: 2026-10-08
- Decision owners: DraftLoop maintainers

## Context

Today a workspace holds exactly one job description (`job.md`), and its runs,
briefs, exports and canonical profile versions belong to that one job.
Career evidence is already per candidate: the knowledge base lives outside
any workspace ([ADR 0007](0007-portable-candidate-knowledge-store.md)).

Real use on 2026-10-08 exposed three problems with that shape:

- **No path to a second application.** After a review is exported, opening
  the workspace lands on that review. There is no way to start another job.
- **Repeated cost.** The workaround is a new workspace per job, which means
  regenerating the career profile each time. On a slow model that is the most
  expensive step.
- **Drift.** Separate profiles diverge between applications, and the writing
  policy and model settings are duplicated.

## Decision

A workspace is the **candidate's home**:

| Lives once per workspace | Lives per application |
|---|---|
| Career evidence selection (knowledge base) | Job source: pasted text, approved URL, or file |
| The reviewed career profile, updated incrementally | Opportunity brief versions |
| Writing policy and default model pair | Author–critic runs, drafts and decisions |
| Future guided career interview | Exports and application status |

- **Applications.** An *application* is a first-class record inside the
  workspace. Each run and brief records its application, and pins the exact
  profile and brief versions it used, so every exported CV stays
  reproducible.
- **Home.** Opening a workspace lands on **Home**: profile status, evidence
  readiness, the Applications list and a **New application** action. The
  review UI belongs to one application.
- **Reuse.** A new application selects the latest reviewed profile without
  regenerating it.
- **Separate workspaces** remain for a different person, for example a coach
  with several candidates, or for deliberate isolation.

## Screen responsibilities

Added 2026-10-09, after real use showed the journey was hard to follow. Each
screen has one job, and a control appears on exactly one screen:

| Screen | Holds |
|---|---|
| **Home** | Career evidence status, Career profile status, Applications, and Workspace settings (models, writing policy, provider sign-in) |
| **Career evidence** | The only place to add and manage sources |
| **Career profile** | The only place to generate, update and review the profile |
| **Application** | Three steps: job and requirements, profile, review |

Workspace-level settings appear on an application only as links to Home.
Every disabled action says why and offers the step that fixes it. Delivery is
tracked in the [Simple guided workflow milestone](https://github.com/akoita/draft-loop/milestone/29)
(rollup #1092).

## Compatibility

- **Legacy workspaces.** An existing workspace reads as one default
  application built from its `job.md`. Its runs and exports stay readable.
- **Import.** Older per-job workspaces can be imported as applications of
  one candidate workspace. Their sources are left untouched, and profiles are
  not merged.
- **Storage.** New storage goes in focused modules and migrations. The frozen
  hotspot files do not grow.

## Consequences

- **One profile per candidate.** The career profile is generated and reviewed
  once per candidate, and incremental derivation keeps it current.
- **Navigation changes.** Setup cards move under Home or Settings, so the
  review screen is per application.
- **Reuse.** The CLI gains `application` commands, and the desktop and the CLI
  keep calling the same application contracts.

Delivery is tracked in the [Candidate home and applications milestone](https://github.com/akoita/draft-loop/milestone/28)
(rollup #1059).
