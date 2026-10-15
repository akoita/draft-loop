# First-run journey walk

Fixture walks of the desktop first-run journey, recorded as evidence for the
Simple guided workflow stage (rollup #1092). They are implementation evidence
from fixture walks, not validated outcome evidence: no real person, real
material or provider took part.

## Verdict

**The #1092 exit criterion is still not met in fixture mode.** The
[repeat walk](#repeat-walk-2026-10-15-base-ad82177) got further than the
original walk:

- A new application in a demo workspace now reaches a started review offline,
  and every Start blocker is explained.
- Reviewing the extracted requirements is a dead end. The brief cannot be marked
  reviewed because it has no employer, and the review dialog has no way to add
  one (R1).
- Start stays available, because the run falls back to the raw job description.
  Step 1 says the opposite: "A draft cannot start a run until you review it"
  (R2).

The criterion asks for a started review with no dead end and every disabled
control offering its fix. R1 fails both.

## Repeat walk (2026-10-15, base `ad82177`)

### Setup

- **Base commit.** `ad82177`: `main` at `a7031e3` plus #1251 (offline profile
  generation and requirement extraction in a demo workspace).
- **Mode, material and viewport.** As in the
  [original walk](#original-walk-2026-10-15-base-bde5022): a demo
  workspace reporting `local fixture (no network)`, one synthetic career-facts
  file and a synthetic job description, 1280 x 800 px in light and dark themes.
- **How it was driven.** The same Chrome DevTools Protocol harness against the
  real Electron main process and preload, with a fresh user-data directory.
  The host log shows no provider call during the walk.

### Steps walked

| # | Step | Outcome | What the person sees |
|---|---|---|---|
| 1 | Start page | Done | "To begin, create a workspace for your job search, open a recent one, or try the demo with sample material." No host error. |
| 2 | Try demo workspace | Done | After choosing a parent folder, Home shows Career evidence Ready, Career profile Not yet generated, and the pre-seeded Default application In review. |
| 3 | Add career evidence | Done | **Add files** created and selected the "Career evidence" knowledge base; the file is Ready with its detected kind. |
| 4 | Generate the profile | Done, offline | The consent box reads "Build the profile from my career evidence with local fixtures. Nothing is sent to a provider." Generation produced 9 facts and 11 open warnings. |
| 5 | Review the profile | Done | "Set all 11: Acknowledged", **Save draft edits**, then **Mark latest draft reviewed**. The status reads "Ready. Reviewed version 3 is used for new applications." |
| 6 | New application | Done | Home's form with a name and pasted job text. The application opened at step 3, with steps 1 and 2 already Done and the checklist "Ready to start the review". |
| 7 | Extract requirements | Done, offline | A confirmation says nothing is sent. The result is "Requirements brief v1 (draft) · 4 requirements, 0 critical. A draft cannot start a run until you review it." |
| 8 | Review the brief | **Dead end** | The dialog lists the 4 requirements and "Employer: Not found in the job description". **Mark reviewed** is disabled, with "The brief has no employer." above it and no field to add one. |
| 9 | Profile (step 2) | Done | "Reviewed career profile · Selected · Using career-profile · version 3". |
| 10 | Data sent (step 3) | Done | "Demo remains local · No network transmission". **See exactly what is sent** lists both destinations as `local fixture (no network)`. The checklist already marks the acknowledgement Done, so there is nothing to tick. |
| 11 | Start | Done | The confirmation lists the models as "Demo, no provider call" and the requirements as "Raw job description". **Start** opened the review screen: Awaiting approval, Round 1, version 1, two blocking findings. |
| 12 | Home after start | Done, with a mismatch | The new application shows "1 run", but its chip says Drafting while the review screen says Awaiting approval (R3). |

### New findings

Each finding has a disposition: the issue that owns it, or a note.

| ID | Finding | Disposition |
|---|---|---|
| R1 | **Dead end.** The brief review cannot be completed when the brief has no employer. The demo's extraction never sets one, so every demo brief hits this. The dialog shows the reason but offers no fix: it has no employer field. | [#1265](https://github.com/akoita/draft-loop/issues/1265) |
| R2 | Step 1 says "A draft cannot start a run until you review it", yet the checklist says "Ready to start the review" and Start is enabled. Only the Start confirmation reveals that the run uses the raw job description. | [#1265](https://github.com/akoita/draft-loop/issues/1265), with a product decision on draft briefs |
| R3 | Home labels the new application Drafting after its review started and awaits approval. The mismatch survives a renderer reload; the pre-seeded application with a run shows In review. | [#1266](https://github.com/akoita/draft-loop/issues/1266) |
| R4 | The demo profile fixture files every line under Achievement, headings included ("Skills"), and raises 11 omission warnings for employers, roles, dates and skills that the file names. Bulk acknowledgement makes this quick. | Noted; demo realism only |
| R5 | The first profile a person reviews is called "version 3", because generation, the issue save and the review each create a version. | Noted |
| R6 | **Mark reviewed** on the brief and **Update profile** under the profile's Details are disabled without a linked reason. The brief's reason sits in the list above its buttons; Update profile has none nearby. | [#1265](https://github.com/akoita/draft-loop/issues/1265) |

### Earlier findings rechecked

- **Resolved.** D1 and D2 (#1251): generation and extraction run offline, and
  the consent copy says nothing is sent. D4 and D6 (#1253): the review header
  shows the Round 1 chip and loop-rail labels at 1280 px, and the dark theme's
  disabled **Approve artifact** looks disabled. D7 (#1254): the start page leads
  with guidance.
- **Not rechecked.** D3 (#1252), because the walk added evidence before opening
  the Career evidence page. D5, because the walk did not open the override form.
- **Unchanged.** D8: the demo still opens with the Default application In
  review.

### Disabled controls and overflow

- **Explained in place.** Clear recent workspaces, Generate profile (tick the
  approval box), Mark latest draft reviewed (open issues, then unsaved
  decisions), Approve artifact (blocking findings), Export Markdown (available
  after approval), and Changes only (no previous version).
- **Self-evident.** Review and fetch job URL with an empty address box, Import
  opportunity override with nothing chosen, Save changes with no edits, and the
  current choice in "Set all".
- **Unexplained or unfixable.** The brief's Mark reviewed (R1, R6) and Update
  profile (R6).
- **Overflow.** No page overflowed horizontally at 1280 px.

## Original walk (2026-10-15, base `bde5022`)

The original walk stopped at profile generation, which then had no fixture
path. Its record is kept as history.

### Original verdict

**The #1092 exit criterion was not met in fixture mode.** A first-time user in a
demo workspace could not start a review on an application they created:

- Start requires a reviewed career profile.
- Profile generation had no fixture path. In a demo workspace it called the
  configured provider, so the walk stopped there.

Everything else in the journey had a next action that was visible and explained.
The review was walked to approval on the demo's pre-seeded application, the only
started review reachable offline.

### Original setup

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

### Original steps walked

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

### Dead ends and unclear controls

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

No trivial copy or wiring fix was found, so that change contained no code fix.

#### Disabled controls

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

### Not exercisable in fixture mode

- Profile generation, and so profile review.
- Requirement extraction and requirement review.
- Starting a review on an application the person created.
- Completing the export, because the walk did not drive the native Save
  dialog. The fixture export path is covered by `pnpm desktop:smoke`.

### Follow-up issues

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
