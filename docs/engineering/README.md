# Engineering guides

These guides show a developer or a coding agent how to make the changes
DraftLoop needs most often: which packages to touch, in what order, and which
checks prove the change. [AGENTS.md](../../AGENTS.md) holds the rules; these
pages hold the steps. The [architecture overview](../architecture/overview.md)
explains why the boundaries are where they are.

| Guide                                        | Use it when you                                                      |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [Change checklist](change-checklist.md)      | Finish any change and fill in the PR template's impact sections      |
| [Add an API route](api-route.md)             | Expose a capability over the HTTP API, and so to the web and agents  |
| [Add a shared screen](shared-screen.md)      | Add or change a screen in `packages/ui` that the web and desktop share |

Write a new guide when a pull request repeats a pattern that no guide covers.
Keep it under about 150 lines, link the architecture page instead of restating
it, and add it to this table and to AGENTS.md in the same change.
