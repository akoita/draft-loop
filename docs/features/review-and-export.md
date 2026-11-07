---
status: available
---

# Review and export

After a run drafts a CV, you decide the critic's findings, edit blocks, approve
the draft and export it. The same page holds the settings that shape later
runs: the model pair, the run budget, autopilot and writing preferences. This
page is for a candidate reviewing a draft and a developer changing review.

## Where it runs

On every server: self-hosted, hosted and the desktop client over it. The
source-only CLI has its own review and export commands
([CLI and desktop reference](../reference/cli-and-desktop.md)).

## How to use it

1. Open the run. Decide each finding, or edit a block directly.
2. Approve the draft, or ask for another round; a worker drafts it. You can
   pause, resume or stop a run.
3. Export the approved draft as Markdown, DOCX or PDF, from the `classic`,
   `compact` or `modern` template (`modern` is the default).
4. Accept or dismiss the **writing preferences** that DraftLoop suggests from
   your review choices. An accepted one joins the writing policy, which keeps
   every version.

| Setting    | What it does                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Model pair | Author and critic model versions from two different companies, per workspace or per application                     |
| Run budget | Round, cost and duration limits for new runs, under the deployment's ceiling; an estimate shows before a run starts |
| Autopilot  | Keeps revising through blocking findings up to the round limit, pausing early only when needed                      |

### When a model call fails

The failure card says what the run needs from you. Stop always ends the run,
even while a call is running.

| Card                | Meaning                                                                                     | What to do                    |
| ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| Retrying on its own | The server retries the step, up to 3 attempts; the card names the next attempt and its time | Wait; Stop asks to confirm    |
| Waiting for you     | A retry or another action needs you, as after a key problem                                 | Fix the cause, then Retry     |
| Can't recover       | No attempt is left                                                                          | Stop, then start a new review |

## How to test it

- Walk steps 4 and 5 of the [local server stack](../operations/local-server-stack.md);
  demo mode drafts with no provider call.
- Focused tests: `apps/api/src/review-routes.test.ts`,
  `apps/api/src/export-routes.test.ts`,
  `apps/api/src/preference-suggestion-routes.test.ts`,
  `packages/ui/src/export-template.test.ts`,
  `packages/ui/src/provider-recovery.test.tsx` and
  `packages/orchestrator/src/person-hold.test.ts`.

## Surfaces

| Kind   | Surface                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------- |
| Screen | Review page, Export area, run details, Home's writing policy                                             |
| API    | `/v1/workspaces/{id}/runs/{runId}/review`, `.../findings/{findingId}/decision`                           |
| API    | `.../runs/{runId}/edits/{blockId}`, `.../approve`, `.../revision`, `.../pause`, `.../resume`, `.../stop` |
| API    | `.../runs/{runId}/exports`, `.../exports/{exportId}/content`                                             |
| API    | `/v1/workspaces/{id}/writing-policy`, `/v1/workspaces/{id}/preference-suggestions`                       |
| API    | `/v1/workspaces/{id}/models`, `.../budget`, `.../autopilot`, `.../runs/estimate`                         |
| MCP    | none yet; run status is planned in [#2440](https://github.com/akoita/draft-loop/issues/2440)             |

## Limits

- CV quality is not validated yet (#1309); the drafting row in the catalog
  stays `partial` until that gate passes.
- The server refuses a model pair whose author and critic come from the same
  company.

## Related

- [Drafting and review architecture](../architecture/drafting-and-review.md)
- [Runtime and trust architecture](../architecture/runtime-and-trust.md)
