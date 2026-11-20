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
2. Derive the profile. Before a large update, the page says how many sources
   it reads again and reuses, the expected model calls and a cost range.
   A worker reads the selected evidence and saves a new
   draft version; you can cancel it while it runs. When it ends, the page
   says how many sources it reused and extracted, and what its model calls
   used: calls, tokens and an estimated cost.
3. Edit facts, then set each fact's or section's **usage**: on your CV, only
   in interview answers, or never. A fact with no level takes its section's,
   and otherwise may be used on a CV.
4. Resolve or acknowledge open issues, then mark the draft reviewed. The page
   says when the profile is behind the evidence.

Cover letters and interview guides draw on the last reviewed version. A newer
draft is used once you review it, and a new draft says when one waits. Before
any version is reviewed, they use the newest draft and say so. CV runs pin a
reviewed profile.

Suggested updates wait for you to decide. Each one proposes adding,
correcting, retiring, setting the usage of or confirming one fact, and quotes
who said it and where. Accepting saves the quotes as a dated candidate
statement in your career evidence and a new profile version citing it, with
no model call; a reviewed profile stays reviewed. Rejecting keeps the same
change from being suggested again. The page's **Suggested updates** box
shows one card per suggestion, with the fact now and as suggested, the quote,
who said it and where; Home's career card counts the ones waiting. Accept,
edit the value and accept, or reject each one. The box waits while the page
has unsaved edits, because accepting saves a new version.

Usage is separate from sensitivity: usage decides where a fact may appear,
sensitivity decides what may reach a model provider.

## How to test it

- The [local server stack](../operations/local-server-stack.md) derives a
  profile in demo mode with no provider call.
- Focused tests: `packages/domain/src/fact-usage.test.ts`,
  `packages/ui/src/profile-fact-usage.test.tsx`,
  `packages/ui/src/profile-fact-suggestions.test.tsx`,
  `apps/web/src/fact-suggestions-bridge.test.ts`,
  `apps/api/src/profile-routes.test.ts`,
  `apps/api/src/fact-suggestion-routes.test.ts`,
  `packages/application/src/review-edit-suggestions.test.ts` and
  `apps/api/src/review-routes.test.ts`.

## Surfaces

| Kind   | Surface                                                                    |
| ------ | -------------------------------------------------------------------------- |
| Screen | Career profile page, the next-step box on the Career evidence card         |
| Screen | Suggested updates box on the profile page, its count on Home               |
| API    | `GET`/`PATCH /v1/workspaces/{id}/profiles/{profileId}`, `.../versions`     |
| API    | `POST`/`GET`/`DELETE .../profiles/{profileId}/derivation`, `.../freshness` |
| API    | `GET .../profiles/{profileId}/derivation-estimate`                         |
| API    | `POST .../profiles/{profileId}/review`                                     |
| API    | `GET`/`PUT /v1/workspaces/{id}/fact-usage`                                 |
| API    | `GET .../profiles/{profileId}/suggestions`, `POST .../suggestions/accept`  |
| API    | `POST .../suggestions/{suggestionId}/reject`                               |
| MCP    | none                                                                       |

## Limits

- A CV run withholds the whole source chunk a held-back fact was quoted from, so
  other text in that chunk is left out too.
- A CV run keeps the usage levels it started with; a level changed while it
  waits applies to the next run.
- The derivation's usage, failed calls included, is kept with the job's
  outcome and read through `GET .../derivation`. The worker also logs one
  content-free line per call. The page gives no estimate before a derivation
  starts yet.
- Approving a CV run files a suggestion when an edit changes a number, date
  or name of a fact in the run's pinned profile, matched by a word diff with
  no model call, and the approved review says how many wait with a link to
  them. Nothing else files them yet, and a card does not name the
  application yet.
- Accepting and rejecting suggestions are people-only routes; an agent token
  cannot reach them or list suggestions yet. Every decision is recorded with
  the candidate role; coach decisions come with coach accounts.
- One derivation runs per profile at a time; a second answers
  `409 derivation_running`.
- Derivation calls the writer's model, so in sign-in mode it needs the
  candidate record's consent to send material to the writer's company. On the
  web, ticking the send approval records that consent when it is missing, and
  keeps every provider the record already names.

## Related

- [Candidate evidence architecture](../architecture/candidate-evidence.md)
- [Memory model](../architecture/memory.md)
