# How DraftLoop shows itself

This page is for a candidate or coach who wants DraftLoop simpler or fuller.
One **Display** choice in **Workspace settings** on Home sets how much each
screen shows at once.

| Display         | What you see                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------- |
| Simple          | The default. Each card shows the basic path; technical choices sit under **Advanced options**. |
| Guided          | The simple view for now; a step-by-step guide on Home follows ([#2791](https://github.com/akoita/draft-loop/issues/2791)). |
| Show everything | Every **Advanced options** section and the Prepare panel start open. You can still fold one.  |

Show everything adds nothing new to a screen. It only removes the click that
opens each folded section.

## Change it

1. Open **Workspace settings** on Home.
2. Next to **Display**, select **Change**.
3. Pick **Guide me step by step** or **Show everything**, or **Use the simple
   view** to go back.

The screens change at once.

## Where the choice is kept

- **Signed in on a server with accounts:** on your account, so it follows you
  to every browser and device.
- **Before sign-in, and on a self-hosted server without accounts:** in this
  browser.

Agents do not see the screens, so no agent tool reads or changes it.

For a developer: the account route is `GET` and `PUT /v1/me/display-preference`,
and the screens read it through `packages/ui/src/display-preference.tsx`.
