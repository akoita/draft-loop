# How DraftLoop shows itself

This page is for a candidate or coach who wants DraftLoop simpler or fuller.
One **Display** choice in **Settings** on Home sets how much each
screen shows at once.

| Display         | What you see                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Simple          | The default. Each card shows the basic path; technical choices sit under **Advanced options**. |
| Guided          | The simple view plus a **Getting started** list on Home that walks you to your first CV.       |
| Show everything | Every folded section starts open. You can still fold one.                                      |

Show everything adds nothing new to a screen. It only removes the click that
opens each folded section: every **Advanced options**, the Prepare panel, and
on the CV review the approval **Details**, **Traceability**, **See exactly
what is sent**, and the run's steps and evidence for each requirement.

## The first question

The first time you open Home, one card asks **How would you like to start?**

- **Guide me step by step** sets Guided.
- **I know apps like this** sets Show everything.
- **Decide later** keeps the simple view.

The card does not come back once you answer.

## Getting started

Guided people see five steps at the top of Home. Each step ticks itself once
the work is done:

1. Tell us about your career: add documents, or tell it in a conversation.
2. Check what we found in **Career profile**.
3. Add the job you want.
4. Review your CV and approve it.
5. Download it.

Steps 4 and 5 follow the application you worked on last and name it. An older
approved application does not tick them for a newer one. When that
application's last review stopped or ran out of budget, step 4 says to start a
new review from **Run details**.

The current step has one button that opens the right screen. **Hide the
guide** folds the list to one line, and **Show the guide** brings it back.
Once the application you worked on last is downloaded, the list becomes one
line that says every step is done, with a **New application** button for the
next job. Once you hide the
guide, Home keeps one hint line that says what to do next.

Guided also puts one line at the top of Career evidence, Career profile, New
application and the CV review. It says what to do on that screen. Once a CV
is approved, the review's line says to pick a template and export it.

On the simple view, Home offers the guide once in one line: **Show me the
steps** turns Guided on, **No thanks** hides the offer.

## Change it

1. Open **Settings** on Home.
2. Under **Display**, pick one of the three cards: **Guide me step by step**,
   **Simple** or **Show everything**. The current one is marked **Current**.

The screens change at once, including sections already open on the screen. A
line under the cards says where the current choice shows.

## Where the choice is kept

- **Signed in on a server with accounts:** on your account, so it follows you
  to every browser and device.
- **Before sign-in, and on a self-hosted server without accounts:** in this
  browser.

Agents do not see the screens, so no agent tool reads or changes it.

For a developer: the account route is `GET` and `PUT /v1/me/display-preference`,
and the screens read it through `packages/ui/src/display-preference.tsx`.
