---
status: partial
---

# Help

A member opens a short user guide from the **Help** button in the header of
every screen. The guide walks the first journey: add career evidence, add a
job, run a draft, review and export, prepare for the job, and choose how much
each screen shows.

## Where it runs

Every server's web screen, in owner-token and sign-in mode, and the desktop
client over it. Phones get the same guide at full width.

## How to use it

Select **Help** in the header. A side sheet opens with one section per step;
the first one is open. Select a title to open or fold its section. Close it
with **Close**, Escape, or a click outside where the browser supports it.

The guide follows the screen language: English or French.

## How to test it

```sh
pnpm vitest run packages/ui/src/help-panel.test.tsx
```

The test checks that each language has every section, in order, and that the
dialog renders them in English and French.

## Surfaces

| Surface | What it does |
| --- | --- |
| Web header: **Help** | Opens the guide in a modal side sheet |
| `packages/ui/src/help-guide-en.ts`, `help-guide-fr.ts` | The guide's text, one module per language |

## Limits

- Sections name the screens to open but do not link to them yet.
- No search, and the guide covers the first journey only; the full guide and
  search are #2880, agent access is #2881.
- Not on the sign-in and sign-up screens, which come before any record.

## Related

- [Display](../reference/display.md) for Guided, Simple and Show everything.
- [Feedback](feedback.md) when the guide does not answer a question.
