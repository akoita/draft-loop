---
status: partial
---

# Plans and credits

On the hosted service, an organisation's plan sets what it may use, and runs
spend credits from the plan's allowance. Plans are data: services read the
entitlements, never a plan name, so a plan changes without a code change. This
page is for an operator assigning plans and a developer adding a limit.

## Where it runs

The hosted service in sign-in mode only. A self-hosted server signs in with the
owner token, has no organisation and answers `404` on these routes.

## How to use it

- An **operator** assigns an organisation's plan and grants extra credits.
- A **member** reads the plan, its limits and the credit balance under
  **Credits and consent**. The screen warns once most of the period's
  allowance is used.
- Before a run starts, DraftLoop estimates the credits it would reserve; a
  started run counts at once.

The catalog's plans are Free, Beta, Individual, Job-search pass, Pro, Team,
Business and Internal.

- **Free** gives one welcome application on the standard pair, 20 model calls
  a day outside runs and one candidate record. Its credit does not come back
  each month.
- **Beta** is the free plan of the invite-only public test: three economy runs
  over three months, at most two a day and one at a time, one candidate record
  and no professional features.
- **Individual** grants 5 credits a month.

The catalog also lists two **credit packs**, bought once with no subscription:
1 credit for €5 and 5 credits for €22, valid 12 months. Buying one is not built
yet; an operator grants the credits.

A plan sets these entitlements:

| Entitlement           | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| Credits per period    | Credits granted each period (one month, three for a pass or Beta)    |
| Model tiers           | The model tiers a run may use                                        |
| Seats                 | Active members plus pending invitations                              |
| Candidate records     | Records the organisation may hold                                    |
| Runs per day, at once | Daily and concurrent run limits                                      |
| Model calls per day   | Interview turns, drafts and profile derivations outside runs         |
| Features              | Switches such as run comparison or bring-your-own-key                |

## How to test it

- Focused tests: `packages/domain/src/entitlements.test.ts`,
  `packages/schemas/src/entitlements.test.ts`,
  `apps/api/src/credit-routes.test.ts`,
  `apps/api/src/operator-plan-routes.test.ts` and
  `apps/web/src/credits.test.tsx`.
- `pnpm test:postgres` adds the Postgres plan-limit and entitlement suites.

## Surfaces

| Kind   | Surface                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| Screen | Credits and consent                                                           |
| API    | `GET /v1/organisation/credits`, `GET /v1/workspaces/{id}/runs/estimate`       |
| API    | `/v1/operator/organisations/{id}/plan`, `.../credit-grants`, `.../credits`    |
| API    | `GET /v1/usage`, `GET /v1/workspaces/{id}/runs/{runId}/usage` (cost by model) |
| MCP    | none                                                                          |

## Limits

- Partial: prices and self-service sign-up are not live, and production is held.
- Free and Beta allow 20 model calls a day outside runs; past that, those routes answer
  `429 model_call_cap_reached` until midnight UTC. Brief extraction is free.
- A credit covers 20 cover letter or question drafts, interview guides and
  research runs for its application, outside the daily count; past that, those
  routes answer `429 prepare_fair_use_reached`. An application without a credit
  counts them against the day.
- An organisation with no plan answers `403 plan_required`.
- A deployment can set a monthly spend pool across organisations; when it is
  used, run starts answer `503 spend_pool_exhausted` until the next month.

## Related

- [ADR 0011](../adr/0011-client-server-version.md), decision D13
- [Organisations and consent](organisations-and-consent.md)
