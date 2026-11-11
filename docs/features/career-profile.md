---
status: available
---

# Career profile

The career profile is the reviewed list of facts about your career that every
draft starts from. DraftLoop derives it from your
[career evidence](career-evidence-sources.md); you edit it, mark where each
fact may be used, and review it before a run can bind it. This page is for a
candidate building a profile and a developer changing it.

## Where it runs

On every server: self-hosted, hosted and the desktop client over it.

## How to use it

1. After the first document is ready, the Career evidence card shows
   **Next: build your career profile**. Choose **Continue to Career profile**.
2. Derive the profile. A worker reads the selected evidence and saves a new
   draft version; you can cancel it while it runs.
3. Edit facts, then set each fact's or section's **usage**: on your CV, only
   in interview answers, or never. A fact with no level takes its section's,
   and otherwise may be used on a CV.
4. Resolve or acknowledge open issues, then mark the draft reviewed. The page
   says when the profile is behind the evidence.

Usage is separate from sensitivity: usage decides where a fact may appear,
sensitivity decides what may reach a model provider.

## How to test it

- The [local server stack](../operations/local-server-stack.md) derives a
  profile in demo mode with no provider call.
- Focused tests: `packages/domain/src/fact-usage.test.ts`,
  `packages/ui/src/profile-fact-usage.test.tsx` and
  `apps/api/src/profile-routes.test.ts`.

## Surfaces

| Kind   | Surface                                                                    |
| ------ | -------------------------------------------------------------------------- |
| Screen | Career profile page, the next-step box on the Career evidence card         |
| API    | `GET`/`PATCH /v1/workspaces/{id}/profiles/{profileId}`, `.../versions`     |
| API    | `POST`/`GET`/`DELETE .../profiles/{profileId}/derivation`, `.../freshness` |
| API    | `POST .../profiles/{profileId}/review`                                     |
| API    | `GET`/`PUT /v1/workspaces/{id}/fact-usage`                                 |
| MCP    | none                                                                       |

## Limits

- A CV run withholds the whole source chunk a held-back fact was quoted from, so
  other text in that chunk is left out too.
- A CV run keeps the usage levels it started with; a level changed while it
  waits applies to the next run.
- One derivation runs per profile at a time; a second answers
  `409 derivation_running`.
- Derivation calls a model, so in sign-in mode it needs the candidate record's
  consent to send material.

## Related

- [Candidate evidence architecture](../architecture/candidate-evidence.md)
- [Memory model](../architecture/memory.md)
