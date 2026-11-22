---
status: partial
---

# Help

A member opens and searches a user guide from the **Help** button in the
header of every screen. The guide walks the first journey (career evidence, a
job, a draft, review and export, Prepare), then covers Display, agents, plans
and credits, privacy, and what to do when something goes wrong. Its Advanced
sections, at the end, cover connecting an agent and its permissions, how a
draft is written and checked, private sections and screening, the data
download, and running Redakloop on your own computer. Settings > Agents links
to the agent steps.

## Where it runs

Every server's web screen, in owner-token and sign-in mode, and the desktop
client over it. Phones get the same guide at full width. Agents read the same
guide through the MCP server.

Visitors who are not signed in read the same guide as a public page at
`/guide/` (English) and `/guide/fr/` (French). The web build writes both pages
from `packages/user-guide`, so the text is never copied. Eight sections
show a screenshot under their text, taken on a local demo workspace with
fictional data; the in-app panel shows the text only. To refresh one, replace
`apps/web/public/guide/images/<section>.<en|fr>.webp` and its size in
`apps/web/src/guide-images.ts`. The about page,
the landing page, the web header's Help menu and the Help panel link to it.

## How to use it

Select **Help** in the header. A side sheet opens with one section per topic.
The section that fits the screen behind it is open: running a draft on a
review without a draft, or the next step's topic on Home. Elsewhere the first
section is open. Select a title to open or fold its section. Type in
**Search the guide** to list only the matching sections, open and best
first; accents and case do not matter. Close it with **Close**, Escape, or a
click outside where the browser supports it.

The guide follows the screen language: English or French.

The Help menu's last line names the server's release and the day it was
built, such as `Version 0.26.47 · Released 20 Nov 2026`. The deploy bakes
both into the API image (`DRAFT_LOOP_SERVER_RELEASE`,
`DRAFT_LOOP_SERVER_RELEASED_ON`), and `GET /v1/health` reports them. A local
or self-hosted build without a `server-vX.Y.Z` tag shows no version line.

When the server runs the support assistant, **Ask a question** sits above the
search. Type a question in your own words and select **Ask**. Asked what to do
next, it reads the same next step the screens show for the application you
worked on last. The answer names the guide sections it used; select one to
open it below. Answer **Did this
solve it?** with **No**, or get an answer that needs a person, and **Talk to a
person** appears. It shows what is sent before **Send the conversation**
(sign-in mode only).

### Limits on the assistant

Each question is a paid model call, so the server bounds it before any call.
Over a limit, the member gets the matching guide sections and a sentence that
says which limit applies and when it lifts, in English or French.

| Limit | Default | Setting |
| --- | --- | --- |
| Question length | 1,000 characters | Fixed |
| Questions per member in any minute | 5 | `DRAFT_LOOP_SUPPORT_MEMBER_QUESTIONS_PER_MINUTE` |
| Questions per member per UTC day | 20 | `DRAFT_LOOP_SUPPORT_MEMBER_DAILY_QUESTIONS` |
| Estimated cost of all members per UTC day | US$2 | `DRAFT_LOOP_SUPPORT_DAILY_COST_USD` |
| Model calls per question, output per call | 4 calls, 1,200 tokens | Fixed |

In sign-in mode the daily counts live in Postgres, so a restart or a second
API instance never resets them. The per-minute window stays in each
instance's memory. Owner-token mode keeps all counts in memory.

The operator changes these without a deploy through
`DRAFT_LOOP_SUPPORT_LIMITS_SECRET`, a Secret Manager version the API reads
within a minute. Its JSON sets any of `assistant` (`on` or `off`, the kill
switch), `memberQuestionsPerMinute`, `memberDailyQuestions` and
`dailyCostUsd`; a field it leaves out keeps the environment's value. An
invalid value keeps the environment's limits and logs a warning.

Each refusal by a limit logs a `support_limited` warning with the reason, the
member id and the organisation id, never the question.

An agent calls `search_help` with a question's words, or reads the whole
guide from `draftloop://help/guide/en` or `/fr` as Markdown.

## How to test it

```sh
pnpm vitest run packages/ui/src/help-panel.test.tsx packages/user-guide packages/support apps/api/src/help-routes.test.ts apps/api/src/support-routes.test.ts apps/mcp/src/help.test.ts apps/web/src/guide-page.test.ts
```

The tests check that each language has every section, in order, that the
dialog renders them in English and French, and that common words in either
language find the right section, and that the API route and the MCP tool
return the guide to a signed-in member or an agent token. The public page
tests check that each language's page holds every section and no inline
script or style. The support tests
play a fake model: each tool, each limit, the switch, refusals, and the
40-question golden set reaching the right section.

The paid check (#2884) asks the real model the same 40 questions, with an
invented account. It never runs in CI: an operator starts it as a job that
has the worker's Claude route. It stops before any call that could pass its
cap, `DRAFT_LOOP_SUPPORT_CHECK_CAP_USD` (default 0.50, at most 1). It prints
one line per question, then answered and refused correctly, wrong-source
answers and cost per answer.

```sh
pnpm test:support:live
```

## Surfaces

| Surface | What it does |
| --- | --- |
| Web header: **Help** menu | **Quick help** opens the guide in a modal side sheet. The menu also opens the public **User guide** and **About Redakloop** pages in a new tab, **Send feedback** in sign-in mode, and the legal pages |
| Public pages `/guide/`, `/guide/fr/` | The whole guide for visitors, with an EN and FR switch; written by the web build (`apps/web/src/guide-page.ts`) |
| `GET /v1/help`, `GET /v1/workspaces/:workspaceId/help` | The guide or a search of it, `language` `en` or `fr`, `q` up to 200 characters |
| MCP `search_help` (scope `journal`) | Searches the guide for an agent |
| MCP resources `draftloop://help/guide/en`, `/fr` | The whole guide as Markdown |
| `POST /v1/workspaces/:workspaceId/support/conversations` and `…/:conversationId/messages` | The support assistant: answers a question from the guide and the member's plan, credits, runs and next step, or returns the matching sections |
| `…/:conversationId/handoff` | Hands the conversation to a person as a support ticket, with the member's consent; see [Feedback](feedback.md) |
| `packages/support` | The assistant's answering loop, read tools, limits and golden set |
| `packages/user-guide/src/guide-en.ts`, `guide-fr.ts` | The guide's text, one module per language |
| `packages/user-guide/src/search.ts` | Word search over the guide, shared by the browser, the API and MCP |

## Limits

- Sections name the screens to open but do not link to them yet.
- Search matches words, not meaning. **Ask a question** answers in your own words, but only where the server sets `DRAFT_LOOP_SUPPORT_ASSISTANT=on`; elsewhere the panel shows the guide alone.
- Answers to **Did this solve it?** are not recorded.
- The per-minute limit is counted in each API instance's memory, like the request rate limits.
- Not on the sign-in and sign-up screens, which come before any record; the landing page links the public guide instead.
- The public page has no search box; the browser's find works on it.

## Keeping it current

Each section names the feature pages it explains in `helpSectionFeatures`
(`packages/user-guide/src/guide.ts`). `pnpm lint:docs` fails when an available or
partial page in `docs/features/` is in no section. When you add a capability,
add or extend a section in both languages, then name its page there.

## Related

- [Display](../reference/display.md) for Guided, Simple and Show everything.
- [Feedback](feedback.md) when the guide does not answer a question.
