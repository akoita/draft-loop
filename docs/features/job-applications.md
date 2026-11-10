---
status: available
---

# Job applications

A job application holds one target job: its brief, its runs and its
application material. This page is for a candidate starting and finding
applications, and a developer changing job intake or the Home list.

## Where it runs

On every server: self-hosted, hosted and the desktop client over it. A page
address is fetched by `apps/page-fetcher`, the only runtime that reaches public
web servers.

## How to use it

1. On Home, choose **New application** and give the job three ways: paste the
   post, attach a job file, or enter the job page's address.
2. A page address is fetched only after you approve it and choose
   **Extract**. Its text goes to the extraction model, which drafts an
   **opportunity brief**. The application keeps a copy of the page's text,
   dated, so the job stays readable after the page expires.
   The review's **Job** tab shows it with the page's address.
3. Check the brief, edit it, and mark the version reviewed. A run pins one
   reviewed version.
4. Home lists every application with search, a status filter, sort and a
   **List** view. Group applications in one-level **folders**; deleting a
   folder keeps its applications.

Each job source is screened for hidden instructions; a flagged source is held
until an owner or admin releases it
([Sensitivity and screening](sensitivity-and-screening.md)).

## How to test it

- Walk step 3 of the [local server stack](../operations/local-server-stack.md)
  with a fictional job post.
- Focused tests: `apps/api/src/job-page-brief-routes.test.ts`,
  `apps/api/src/application-folder-routes.test.ts`,
  `apps/api/src/application-lifecycle-routes.test.ts`,
  `packages/ui/src/job-description-panel.test.tsx`,
  `packages/ui/src/new-application-form.test.tsx`,
  `packages/ui/src/opportunity-brief-review.test.tsx` and
  `packages/ui/src/home-list-model.test.ts`.

## Surfaces

| Kind   | Surface                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| Screen | Home list and folders, New application form, opportunity brief review, Job tab |
| API    | `/v1/workspaces/{id}/applications`, `.../applications/from-file`, `.../job`    |
| API    | `/v1/workspaces/{id}/opportunities`, `.../{briefId}/versions`, `.../review`    |
| API    | `/v1/workspaces/{id}/application-folders`                                      |
| API    | `POST /v1/workspaces/{id}/application-imports` (from a v0.8 desktop workspace) |
| MCP    | none yet; planned in [#2440](https://github.com/akoita/draft-loop/issues/2440) |

## Limits

- Only public job pages are fetched, one approved address per application.
- A page keeps at most two copies: the first one and the newest one. A later
  read never replaces the first copy, so a closed or expired page cannot erase
  the job.
- An application added from a page before copies were kept has none yet.
- Folders are one level deep; an application sits in at most one folder.

## Related

- [Hosted service architecture](../architecture/hosted-service.md) for the
  page fetcher and screening
- [Review and export](review-and-export.md), what a run does with the brief
