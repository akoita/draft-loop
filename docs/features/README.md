# Feature catalog

This catalog lists every capability a candidate, a coach, an operator or an
agent can reach in Redakloop, with its status and where it runs. Start
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
| server        | The web screen of every Redakloop server: self-hosted, hosted, and the desktop client over it |
| self-hosted   | Only on a [self-hosted server](../operations/self-hosted.md)                                  |
| hosted        | Only on the hosted service                                                                    |
| CLI           | The source-only CLI over a local workspace                                                    |

**Agent access** names the MCP tools an agent can call for the feature
through the [agent channel](../reference/agent-channel.md), or says `none`.

## Running Redakloop

| Feature                                                                             | Status      | Where it runs | Agent access     | What it does                                                                                           |
| ----------------------------------------------------------------------------------- | ----------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| [Self-hosted server](../operations/self-hosted.md)                                  | `available` | self-hosted   | `none`           | Runs the whole client-server stack on your own machine with Docker Compose.                            |
| [Desktop client](../reference/cli-and-desktop.md)                                   | `available` | server        | `none`           | An Electron window over a Redakloop server's web screen; alpha.                                        |
| [Source-only CLI](../reference/cli-and-desktop.md)                                  | `available` | CLI           | `none`           | Runs a local workspace from a source checkout; in maintenance mode.                                    |
| [Hosted service](../architecture/hosted-service.md)                                 | `partial`   | hosted        | `none`           | The same server on Google Cloud in the EU; an invite-only beta in production.                          |
| [Planned-maintenance notice](../architecture/hosted-service.md#planned-maintenance) | `available` | server        | `service_notice` | Shows the operator's planned maintenance on every screen and pauses changes during a read-only window. |

## Career evidence

| Feature                                                                | Status      | Where it runs | Agent access                                                        | What it does                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Evidence files](career-evidence-sources.md)                           | `available` | server        | `none`                                                              | Upload files as career evidence, then download them and see their dates.                                                                               |
| [Pasted text evidence](career-evidence-sources.md)                     | `available` | server        | `none`                                                              | Paste text as a career evidence source instead of uploading a file.                                                                                    |
| [Pull request import](career-evidence-sources.md)                      | `available` | server        | `none`                                                              | Imports your merged pull requests as career evidence, screened for sensitivity.                                                                        |
| [Code project cards](career-evidence-sources.md#code-project-cards)    | `available` | server        | `add_project`                                                       | An agent files a cited card about one code repository, counted from git; it becomes evidence once you approve it, and a CV can list it under Projects. |
| [Career profile](career-profile.md)                                    | `available` | server        | `none`                                                              | Reviewed facts about your career that every draft starts from.                                                                                         |
| [Evidence next step](career-profile.md)                                | `available` | server        | `none`                                                              | The Career evidence page shows the one next step that improves your evidence.                                                                          |
| [Suggested profile updates](career-profile.md)                         | `available` | server        | `get_profile`, `suggest_profile_update`, `list_profile_suggestions` | Approval edits and agents file suggestions; the review offers them and you accept, edit or reject each on the Career profile page.                     |
| [Content screening](sensitivity-and-screening.md)                      | `available` | server        | `none`                                                              | Holds material with hidden instructions until an owner or admin releases it.                                                                           |
| [Private sections and sensitivity rules](sensitivity-and-screening.md) | `available` | server        | `none`                                                              | Keeps chosen material out of drafts and away from model providers.                                                                                     |

## Career interview

| Feature                                                                                                      | Status      | Where it runs | Agent access | What it does                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ----------- | ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [Guided career interview](../reference/career-interview-method.md)                                           | `available` | server        | `none`       | An interviewer asks about your work and turns answers into facts you approve. An empty record gets four starting topics.      |
| [Start from a conversation](../reference/career-interview-method.md#a-first-conversation-on-an-empty-record) | `available` | server        | `none`       | With no documents yet, the Career evidence card and Home offer to start by talking with the interviewer.                      |
| [Answer by voice](../reference/voice-input.md)                                                               | `available` | server        | `none`       | Dictate an interview answer; speech is turned into text before you send it.                                                   |
| [Talk live](../reference/voice-input.md)                                                                     | `partial`   | server        | `none`       | A spoken conversation with the interviewer, within each member's daily live minutes; a measured staging walk is open (#2363). |

## Applications

| Feature                                  | Status      | Where it runs | Agent access | What it does                                                                 |
| ---------------------------------------- | ----------- | ------------- | ------------ | ---------------------------------------------------------------------------- |
| [Job page import](job-applications.md)   | `available` | server        | `none`       | Fetches a job page you approved, then drafts its requirements.               |
| [Opportunity brief](job-applications.md) | `available` | server        | `none`       | Turns a job page, files or pasted text into a brief you review before a run. |
| [Applications list](job-applications.md) | `available` | server        | `none`       | Home lists applications with search, filters, a list view and folders.       |

## Drafting and review

| Feature                                                                                          | Status      | Where it runs | Agent access               | What it does                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------- | ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CV drafting with author and critic](../architecture/drafting-and-review.md)                     | `partial`   | server, CLI   | `none`                     | An author model drafts and a critic from another company reviews; a server may name a [fallback critic](../architecture/drafting-and-review.md#fallback-critic) and a [Claude refusal fallback](../architecture/drafting-and-review.md#claude-refusal-fallback), both shown on Run details. Quality is not yet validated (#1309). |
| [Evidence for each requirement](../architecture/drafting-and-review.md#requirement-evidence-map) | `available` | server        | `get_requirement_evidence` | Lists which sources support each job requirement of a run, by meaning and keywords, in Run details and for agents.                                                                                                           |
| [Fact usage level](career-profile.md)                                                            | `available` | server        | `none`                     | Marks where each fact may be used, such as CVs or interviews.                                                                                                                                                                |
| [Writing preferences](review-and-export.md)                                                      | `available` | server        | `none`                     | Saves preferences you approve from review and applies them to later drafts.                                                                                                                                                  |
| [Model pair and run budget](review-and-export.md)                                                | `available` | server        | `none`                     | Choose author and critic models from two companies and the limits a run may spend.                                                                                                                                           |
| [Autopilot](review-and-export.md)                                                                | `available` | server        | `none`                     | Keeps revising through blocking findings and pauses only when a person is needed.                                                                                                                                            |
| [Review and export](review-and-export.md)                                                        | `available` | server, CLI   | `none`                     | Review findings, approve the draft, preview and export Markdown, DOCX or PDF from templates.                                                                                                                                 |

## Application material

| Feature                                                                                          | Status      | Where it runs | Agent access                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------- | ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Cover letter](../reference/application-material.md)                                             | `available` | server        | `none`                           | Drafts a cover letter from approved facts in your own voice, guided by tone, length and emphasis, to rewrite before sending: the tab asks how much help you want (writing kit by default, full draft by choice), warns that a letter written entirely by AI can be spotted, and the first full draft on an application asks the candidate to accept that risk; a critic from another company flags machine-sounding sentences for one revision. The draft says when the record holds no employer or dates. A server may instead write it as prose and check each sentence against your facts ([free-form](../reference/application-material.md#free-form-cover-letters)). |
| [Check my letter](../reference/application-material.md#check-my-letter) | `partial` | server | `check_cover_letter` | Checks a letter you wrote, without rewriting or keeping it: claims your approved facts do not support with the closest fact, requirements not answered yet, and wording that reads as machine-made (job-ad echoes, empty praise, stock phrases). The wording and requirement checks run without a model and still answer while model calls are paused. Shown under your own letter on the Cover letter tab; agents call it too. |
| [Cover letter writing kit](../reference/application-material.md#cover-letter-writing-kits) | `available` | server | `get_cover_letter_kit` | Prepares the material to write your own letter, never the letter: three requirements with the approved facts that prove them, opening angles and a four-paragraph outline as notes, dated employer facts and phrases to avoid. The Cover letter tab's default: the kit beside an editor for your own letter, saved as a version and downloaded as Word or PDF with no confirm ([screen](../reference/application-material.md#the-writing-kit-screen)). The second choice, an [annotated draft](../reference/application-material.md#the-annotated-draft), shows an AI letter paragraph by paragraph with a note on each and underlined generic phrases, beside a column for your version and a meter of the share in your own words; only your version is saved and exported. |
| [Interview questions](../reference/application-material.md)                                      | `available` | server        | `none`                           | Drafts likely interview questions for one application. The panel now drafts guides instead and keeps earlier question sets readable; agents can still draft them.                                                                                                                                                                                                                                            |
| [Interview preparation guide](../reference/application-material.md#interview-preparation-guides) | `partial`   | server        | `list_materials`, `get_material` | Drafts an essential or extensive guide for one interview from allowed facts, the job and fresh research, with every sentence checked against its source. Offered in the Prepare panel in place of interview questions, and downloads as Word, PDF or Markdown; agents read saved guides. Not yet walked with a paid run (#2623).                                                                             |
| [Saved drafts](../reference/application-material.md#saved-drafts)                                | `available` | server        | `none`                           | Keeps each cover letter and question set with its application, to reopen, edit as a new version, download as Word or PDF, or delete.                                                                                                                                                                                                                                                                         |
| [Research brief](../reference/application-material.md#research-briefs)                           | `partial`   | server        | `none`                           | Researches the employer after the candidate approves, and keeps dated, cited facts with each application, to read or delete. Cover letters and interview questions may cite them for statements about the company. Offered in the Prepare panel; not yet walked with a paid run (#2483).                                                                                                                     |

## Agent channel

| Feature                                                                           | Status      | Where it runs | Agent access                                                                                                                                                                                                  | What it does                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Work journal](../reference/agent-channel.md)                                     | `available` | server        | `record_work`, `list_work`                                                                                                                                                                                    | An agent records notable work as notes you approve as evidence, on a self-hosted server or a signed-in account.                                                                                                                       |
| [Agents](../reference/agent-channel.md#set-it-up)                                 | `available` | server        | `none`                                                                                                                                                                                                        | A Settings section that issues scoped agent tokens, shows the setup and lists every connected agent in one table.                                                                                                                     |
| [Assistant spend limits](../reference/agent-channel.md#the-connections-spend-cap) | `partial`   | hosted        | `none`                                                                                                                                                                                                        | Each assistant connected by sign-in is a row of Connected agents, where its monthly spend limit is set; one that asks to spend first waits there for a limit. Assistant sign-in is not deployed on the hosted service yet (#2650).    |
| [Agents work your applications](../reference/agent-channel.md)                    | `available` | server        | `list_applications`, `get_application`, `get_job_text`, `add_job`, `get_run_status`, `get_cv`, `list_materials`, `get_material`, `estimate_run`, `start_cv_run`, `draft_cover_letter`, `draft_interview_prep`, `get_cover_letter_kit`, `check_cover_letter` | An agent lists applications, reads a job's text, adds a job, starts a CV run, drafts cover letters, writing kits and interview questions and checks the candidate's own letter within a monthly spend cap, follows the run and its next step, and reads exported CVs and saved drafts. |

## Account and data

| Feature                                                         | Status      | Where it runs | Agent access                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ----------- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Screen language](../reference/languages.md)                    | `available` | server        | `none`                                                             | Shows the screens in English or French; switch from any screen, even sign-in.                                                                                                                                                                                                                                                                                                                                                                                                |
| [Display](../reference/display.md)                              | `available` | server        | `none`                                                             | Simple, Guided or Show everything, which opens every folded section.                                                                                                                                                                                                                                                                                                                                                                                                         |
| [Plans and credits](plans-and-credits.md)                       | `partial`   | hosted        | `none`                                                             | Plan entitlements and run credits; prices and sign-up are not live yet.                                                                                                                                                                                                                                                                                                                                                                                                      |
| [Readable export](../reference/readable-export.md)              | `available` | hosted        | `none`                                                             | Download everything gives a person their documents, applications, profile and journal as files they can open.                                                                                                                                                                                                                                                                                                                                                                |
| [Record archive](../reference/record-archive.md)                | `available` | hosted        | `none`                                                             | Owners download everything kept about one candidate record as a zip.                                                                                                                                                                                                                                                                                                                                                                                                         |
| [Organisations and members](organisations-and-consent.md)       | `available` | hosted        | `none`                                                             | Invite people, set roles and choose who opens each job search; sign-up accepts the published terms.                                                                                                                                                                                                                                                                                                                                                                          |
| [Consent and erasure](organisations-and-consent.md)             | `available` | hosted        | `none`                                                             | Records consent before storing material, and erases a record, an organisation, or a person's own account with their sign-in.                                                                                                                                                                                                                                                                                                                                                 |
| [Help](help.md)                                                 | `partial`   | web, server   | `search_help`                                                      | A Help menu on every screen opens a searchable user guide in English or French, also public at `/guide/` and linked from the menu with the About page and ending with the server's version and release day, and an AI assistant that answers questions and hands them to a person where the server turns it on; agents search and read the same guide.                                                                                                                       |
| [Feedback](feedback.md)                                         | `partial`   | web, server   | `send_feedback`; the operator's `list_feedback`, `triage_feedback` | A member sends the operator a note about Redakloop, with its technical context, from Send feedback in the header's Help menu or through their agent. The operator triages notes on the operator screen's inbox or through the API, links GitHub issues and replies to the member by email.                                                                                                                                                                                                                  |
| [Operator screen](organisations-and-consent.md#operator-screen) | `available` | server        | `none`                                                             | The operator invites people from the beta waitlist, which emails each one a single invite to choose a password and join, follows invites and the seats used, is warned before inviting past the account cap, changes the cap at runtime with `pnpm beta:cap`, and triages members' feedback in an inbox; each list pages and searches, so it handles hundreds of rows. It also reads one member's run trace, content-free, opened from the feedback note that names the run, and a content-free usage funnel of where testers stop, week by week. |

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
- an MCP tool in `apps/mcp/src/server.ts` is not named in an Agent access cell;
- an available or partial feature page is named in no section of the
  [user guide](help.md#keeping-it-current).

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
