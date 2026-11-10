# Feature catalog

This catalog lists every capability a candidate, a coach, an operator or an
agent can reach in DraftLoop, with its status and where it runs. Start
here before reading the architecture or the code. The
[roadmap](../roadmap.md) holds stages and priorities; this page holds what is
true now.

## Legend

| Status      | Meaning                                                    |
| ----------- | ---------------------------------------------------------- |
| `available` | Works today where the row says it runs.                    |
| `partial`   | Works with a named limit; the row names it and its issue.  |
| `planned`   | Approved but not built; the row links its issue or design. |
| `retired`   | Removed or replaced; the row says what replaced it.        |

| Where it runs | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| server        | The web screen of every DraftLoop server: self-hosted, hosted, and the desktop client over it |
| self-hosted   | Only on a [self-hosted server](../operations/self-hosted.md)                                  |
| hosted        | Only on the hosted service                                                                    |
| CLI           | The source-only CLI over a local workspace                                                    |

**Agent access** names the MCP tools an agent can call for the feature
through the [agent channel](../reference/agent-channel.md), or says `none`.

## Running DraftLoop

| Feature                                             | Status      | Where it runs | Agent access | What it does                                                                 |
| --------------------------------------------------- | ----------- | ------------- | ------------ | ---------------------------------------------------------------------------- |
| [Self-hosted server](../operations/self-hosted.md)  | `available` | self-hosted   | `none`       | Runs the whole client-server stack on your own machine with Docker Compose.  |
| [Desktop client](../reference/cli-and-desktop.md)   | `available` | server        | `none`       | An Electron window over a DraftLoop server's web screen; alpha.              |
| [Source-only CLI](../reference/cli-and-desktop.md)  | `available` | CLI           | `none`       | Runs a local workspace from a source checkout; in maintenance mode.          |
| [Hosted service](../architecture/hosted-service.md) | `partial`   | hosted        | `none`       | The same server on Google Cloud in the EU; on staging only, production held. |

## Career evidence

| Feature                                                                | Status      | Where it runs | Agent access | What it does                                                                    |
| ---------------------------------------------------------------------- | ----------- | ------------- | ------------ | ------------------------------------------------------------------------------- |
| [Evidence files](career-evidence-sources.md)                           | `available` | server        | `none`       | Upload files as career evidence, then download them and see their dates.        |
| [Pasted text evidence](career-evidence-sources.md)                     | `available` | server        | `none`       | Paste text as a career evidence source instead of uploading a file.             |
| [Pull request import](career-evidence-sources.md)                      | `available` | server        | `none`       | Imports your merged pull requests as career evidence, screened for sensitivity. |
| [Career profile](career-profile.md)                                    | `available` | server        | `none`       | Reviewed facts about your career that every draft starts from.                  |
| [Evidence next step](career-profile.md)                                | `available` | server        | `none`       | The Career evidence page shows the one next step that improves your evidence.   |
| [Content screening](sensitivity-and-screening.md)                      | `available` | server        | `none`       | Holds material with hidden instructions until an owner or admin releases it.    |
| [Private sections and sensitivity rules](sensitivity-and-screening.md) | `available` | server        | `none`       | Keeps chosen material out of drafts and away from model providers.              |

## Career interview

| Feature                                                            | Status      | Where it runs | Agent access | What it does                                                                         |
| ------------------------------------------------------------------ | ----------- | ------------- | ------------ | ------------------------------------------------------------------------------------ |
| [Guided career interview](../reference/career-interview-method.md) | `available` | server        | `none`       | An interviewer asks about your work and turns answers into facts you approve.        |
| [Answer by voice](../reference/voice-input.md)                     | `available` | server        | `none`       | Dictate an interview answer; speech is turned into text before you send it.          |
| [Talk live](../reference/voice-input.md)                           | `partial`   | server        | `none`       | A spoken conversation with the interviewer; a measured staging walk is open (#2363). |

## Applications

| Feature                                  | Status      | Where it runs | Agent access | What it does                                                                 |
| ---------------------------------------- | ----------- | ------------- | ------------ | ---------------------------------------------------------------------------- |
| [Job page import](job-applications.md)   | `available` | server        | `none`       | Fetches a job page you approved, then drafts its requirements.               |
| [Opportunity brief](job-applications.md) | `available` | server        | `none`       | Turns a job page, files or pasted text into a brief you review before a run. |
| [Applications list](job-applications.md) | `available` | server        | `none`       | Home lists applications with search, filters, a list view and folders.       |

## Drafting and review

| Feature                                                                      | Status      | Where it runs | Agent access | What it does                                                                                            |
| ---------------------------------------------------------------------------- | ----------- | ------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [CV drafting with author and critic](../architecture/drafting-and-review.md) | `partial`   | server, CLI   | `none`       | An author model drafts and a critic from another company reviews; quality is not yet validated (#1309). |
| [Fact usage level](career-profile.md)                                        | `available` | server        | `none`       | Marks where each fact may be used, such as CVs or interviews.                                           |
| [Writing preferences](review-and-export.md)                                  | `available` | server        | `none`       | Saves preferences you approve from review and applies them to later drafts.                             |
| [Model pair and run budget](review-and-export.md)                            | `available` | server        | `none`       | Choose author and critic models from two companies and the limits a run may spend.                      |
| [Autopilot](review-and-export.md)                                            | `available` | server        | `none`       | Keeps revising through blocking findings and pauses only when a person is needed.                       |
| [Review and export](review-and-export.md)                                    | `available` | server, CLI   | `none`       | Review findings, approve the draft, preview and export Markdown, DOCX or PDF from templates.            |

## Application material

| Feature                                                     | Status      | Where it runs | Agent access | What it does                                                   |
| ----------------------------------------------------------- | ----------- | ------------- | ------------ | -------------------------------------------------------------- |
| [Cover letter](../reference/application-material.md)        | `available` | server        | `none`       | Drafts a cover letter from approved facts in your own voice, guided by tone, length and emphasis; a critic from another company flags machine-sounding sentences for one revision. A server may instead write it as prose and check each sentence against your facts ([free-form](../reference/application-material.md#free-form-cover-letters)). |
| [Interview questions](../reference/application-material.md) | `available` | server        | `none`       | Drafts likely interview questions for one application. The panel now drafts guides instead and keeps earlier question sets readable; agents can still draft them. |
| [Interview preparation guide](../reference/application-material.md#interview-preparation-guides) | `partial` | server | `list_materials`, `get_material` | Drafts an essential or extensive guide for one interview from allowed facts, the job and fresh research, with every sentence checked against its source. Offered in the Prepare panel in place of interview questions, and downloads as Word, PDF or Markdown; agents read saved guides. Not yet walked with a paid run (#2623). |
| [Saved drafts](../reference/application-material.md#saved-drafts) | `available` | server | `none` | Keeps each cover letter and question set with its application, to reopen, edit as a new version, download as Word or PDF, or delete. |
| [Research brief](../reference/application-material.md#research-briefs) | `partial` | server | `none` | Researches the employer after the candidate approves, and keeps dated, cited facts with each application, to read or delete. Cover letters and interview questions may cite them for statements about the company. Offered in the Prepare panel; not yet walked with a paid run (#2483). |

## Agent channel

| Feature                                                        | Status      | Where it runs | Agent access                                                        | What it does                                                                      |
| -------------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Work journal](../reference/agent-channel.md)                  | `available` | server        | `record_work`, `list_work`                                          | An agent records notable work as notes you approve as evidence.                   |
| [Agents](../reference/agent-channel.md#set-it-up)              | `available` | self-hosted   | `none`                                                              | A Workspace settings section that issues scoped agent tokens and shows the setup. |
| [Agents work your applications](../reference/agent-channel.md) | `available` | self-hosted   | `list_applications`, `get_application`, `get_job_text`, `add_job`, `get_run_status`, `get_cv`, `list_materials`, `get_material`, `estimate_run`, `start_cv_run`, `draft_cover_letter`, `draft_interview_prep` | An agent lists applications, reads a job's text, adds a job, starts a CV run and drafts cover letters and interview questions within a monthly spend cap, follows the run and reads exported CVs and saved drafts. |

## Account and data

| Feature                                                   | Status      | Where it runs | Agent access | What it does                                                                     |
| --------------------------------------------------------- | ----------- | ------------- | ------------ | -------------------------------------------------------------------------------- |
| [Screen language](../reference/languages.md)              | `available` | server        | `none`       | Shows the screens in English or French and switches without a refresh.           |
| [Plans and credits](plans-and-credits.md)                 | `partial`   | hosted        | `none`       | Plan entitlements and run credits; prices and sign-up are not live yet.          |
| [Record archive](../reference/record-archive.md)          | `available` | hosted        | `none`       | Owners download everything kept about one candidate record as a zip.             |
| [Organisations and members](organisations-and-consent.md) | `available` | hosted        | `none`       | Invite people, set roles and assign members to candidate records.                |
| [Consent and erasure](organisations-and-consent.md)       | `available` | hosted        | `none`       | Records consent before storing material, and erases a record or an organisation. |

## Planned

| Feature                                                               | Status    | Where it runs | Agent access | What it does                                               |
| --------------------------------------------------------------------- | --------- | ------------- | ------------ | ---------------------------------------------------------- |
| [Interview preparation](../design/interview-preparation.md)           | `planned` | server        | `none`       | Practice for an interview from approved facts (#1995).     |
| [Freelance mission dossiers](../design/freelance-mission-dossiers.md) | `planned` | server        | `none`       | A dossier for a freelance mission instead of a CV (#1996). |

## Keeping this page current

A pull request that adds, changes, exposes, hides or removes a capability
updates its row here, and its feature page, in the same change. A new MCP tool
must appear in an **Agent access** cell.

`pnpm lint:docs` runs `scripts/feature-catalog.mjs`, which fails when:

- a link in a table does not resolve;
- a page in `docs/features/` is missing from the tables;
- a feature page's `status` front matter differs from its row;
- a row that is not `planned` links no page;
- an MCP tool in `apps/mcp/src/server.ts` is not named in an Agent access cell.

A feature page lives at `docs/features/<feature>.md`, stays under about 150
lines, and starts with front matter holding its status:

```markdown
---
status: available
---

# <Feature name>

<One paragraph: what it does and for whom.>

## Where it runs
## How to use it
## How to test it
## Surfaces
## Limits
## Related
```

**Surfaces** lists the screens, API routes, MCP tools and CLI commands. Where a
`docs/reference/` page already covers a feature, the row links it instead.
