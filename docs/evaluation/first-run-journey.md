# First-run journey walk

A fixture walk of the desktop first-run journey, recorded as evidence for the
Simple guided workflow stage (rollup #1092). It is implementation evidence from
a fixture walk, not validated outcome evidence: no real person, real material
or provider took part.

## Verdict

**The #1092 exit criterion is not met in fixture mode.** A first-time user in a
demo workspace cannot start a review on an application they created:

- Start requires a reviewed career profile.
- Profile generation has no fixture path. In a demo workspace it calls the
  configured provider, so the walk stopped there.

Everything else in the journey has a next action that is visible and explained.
The review was walked to approval on the demo's pre-seeded application, the only
started review reachable offline. A real workspace may well complete the
journey, but this walk did not exercise its provider steps.

## Setup

- **Date.** 2026-10-15.
- **Base commit.** `bde5022`: `main` at `2676ed0` plus #1089 (Home's New
  application form) and #1246 (approved-job-page wording on step 1).
- **Mode.** Fixture: a workspace created with **Try demo workspace**, which
  reports `local fixture (no network)`. No provider was called.
- **Material.** One synthetic career-facts file for a fictional candidate at
  `example.test` employers, and a synthetic job description.
- **Viewport.** 1280 x 800 px, light and dark themes at every step.
- **How it was driven.** The real desktop app: the Electron main process and
  preload, built from this commit, against the renderer served by Vite. The app
  was driven over the Chrome DevTools Protocol, clicking and filling controls in
  the page and capturing each step. Native file and folder dialogs were answered
  by a test shim. The native Save dialog of the export was not automated.
- **Screenshots.** Kept outside the repository, which stores no PNG evidence.

## Steps walked

| # | Step | Outcome | What the person sees |
|---|---|---|---|
| 1 | Start page | Done | "Set up a review workspace" with Create, Open and **Try demo workspace**. |
| 2 | Create a demo workspace | Done | Home: Career evidence, Career profile (Not yet generated), Applications with a pre-seeded Default application already In review. |
| 3 | Add career evidence | Done | **Add files** created the "Career evidence" knowledge base, imported the file and marked it Ready with its detected kind. |
| 4 | Generate and review the profile | Not exercisable | The Career profile page asks to send the evidence to Anthropic; the walk stopped before approving. |
| 5 | Create an application | Done | Home's New application form: name and pasted job text. **Create application** opened the application at its first unfinished step, Profile. |
| 6 | Review requirements | Partly | Step 1 is Done ("Job requirements read from the job description"). **Extract requirements** calls the writing model, so it was not used. |
| 7 | Start a review | Blocked | **Start review · choose a profile first**, with the reason in the Before you can start checklist. **Choose profile** moves focus to the Profile step. |
| 8 | Review (pre-seeded application) | Done | Header with Run details; "Next: decide 1 blocking finding"; one blocking finding with Accept, Reject, Defer and Override. |
| 9 | Approve | Done | After the finding was rejected, the footer said "Not ready" with the readiness reasons. **Approve with override…** with a recorded reason approved the run. |
| 10 | Export | Reached | "Next: export"; **Export Markdown** opened the native Save dialog, which the walk did not drive. |
| 11 | Run details | Done | The drawer shows the run timeline, the author and critic with their lineages, the data policy and **Start a new review**. |

## Dead ends and unclear controls

Each finding has a disposition: the issue that owns it.

| ID | Finding | Disposition |
|---|---|---|
| D1 | **Dead end.** A new application in a demo workspace cannot start a review: Start needs a reviewed profile, and profile generation and requirement extraction call the configured provider. | [#1251](https://github.com/akoita/draft-loop/issues/1251) |
| D2 | The demo's Career profile page asks to "Send my career evidence … to Anthropic", while the application's checklist says "Nothing is sent to a provider from this workspace". | [#1251](https://github.com/akoita/draft-loop/issues/1251) |
| D3 | Home's Career evidence card says Ready, "1 source file in this workspace", for the demo's legacy `evidence` file, while the Career evidence page says "No career evidence yet". | [#1252](https://github.com/akoita/draft-loop/issues/1252) |
| D4 | **Overflow.** At 1280 px, while awaiting approval, the review header clips the "Round 1" chip to "Rou" and hides the loop rail's step labels. | [#1253](https://github.com/akoita/draft-loop/issues/1253) |
| D5 | With the override-reason form open, the sticky approval footer covers the side panel's Findings heading and tabs at 800 px height. | [#1253](https://github.com/akoita/draft-loop/issues/1253) |
| D6 | In the dark theme, the disabled **Approve artifact** keeps a teal fill that is only slightly dimmed, so it is harder to tell from an enabled button than in the light theme. | [#1253](https://github.com/akoita/draft-loop/issues/1253) |
| D7 | The first-run screen leads with the host refusal "Open a workspace first." as its intro line. It reads as an instruction, but it is an error message in a place for guidance. | [#1254](https://github.com/akoita/draft-loop/issues/1254) |
| D8 | The demo workspace opens with a Default application already In review, before any profile exists. It is not a dead end, but it is not the empty start the journey assumes. | Noted; decide with A |

No trivial copy or wiring fix was found, so this change contains no code fix.

### Disabled controls

Every disabled control had a reason on screen or was self-evident:

- **Explained in place.** Clear recent workspaces ("No recent workspaces
  yet"), Generate profile ("Tick the approval box to generate"), Create
  application (named reason), Start review (button text and checklist),
  Approve artifact (blocking-finding and readiness lines), Export Markdown
  ("Available after approval"), Changes only ("This is the first artifact
  version"), Approve with override (reason marked required).
- **Self-evident.** Review and fetch source URL and Review and fetch job URL
  with an empty address box; Import opportunity override with nothing chosen;
  "In use" on the selected knowledge base.
- **Weakly explained.** **Load latest** under the profile's Details has no
  reason beside it; the nearby line "No reviewed profiles are available"
  implies it.

No page overflowed horizontally at 1280 px apart from D4.

## Not exercisable in fixture mode

- Profile generation, and so profile review.
- Requirement extraction and requirement review.
- Starting a review on an application the person created.
- Completing the export, because the walk did not drive the native Save
  dialog. The fixture export path is covered by `pnpm desktop:smoke`.

## Follow-up issues

- **[#1251](https://github.com/akoita/draft-loop/issues/1251) Demo workspace reaches a started review offline.** Outcome: in a demo
  workspace, Generate profile and Extract requirements run against local
  fixtures with no network call, the profile page's consent copy says nothing is
  sent, and a new application reaches a started review with no provider.
  Covers D1, D2 and the D8 decision.
- **[#1252](https://github.com/akoita/draft-loop/issues/1252) Home and the Career evidence page agree on evidence.** Outcome: a
  workspace whose only evidence is legacy workspace files shows the same state
  on Home's Career evidence card as on the Career evidence page.
- **[#1253](https://github.com/akoita/draft-loop/issues/1253) Review screen fits at 1280 x 800 in both themes.** Outcome: the review
  header shows the status, round chip and loop-rail labels without clipping;
  the approval footer never covers the side panel's tabs; a disabled primary
  button looks disabled in the dark theme.
- **[#1254](https://github.com/akoita/draft-loop/issues/1254) First-run screen leads with guidance, not a host error.** Outcome: a
  fresh install's start page says what to do first instead of showing the
  host's "Open a workspace first." refusal.
