---
status: partial
---

# Help

A member opens and searches a user guide from the **Help** button in the
header of every screen. The guide walks the first journey (career evidence, a
job, a draft, review and export, Prepare), then covers Display, agents, plans
and credits, privacy, and what to do when something goes wrong.

## Where it runs

Every server's web screen, in owner-token and sign-in mode, and the desktop
client over it. Phones get the same guide at full width. Agents read the same
guide through the MCP server.

## How to use it

Select **Help** in the header. A side sheet opens with one section per topic;
the first one is open. Select a title to open or fold its section. Type in
**Search the guide** to list only the matching sections, open and best
first; accents and case do not matter. Close it with **Close**, Escape, or a
click outside where the browser supports it.

The guide follows the screen language: English or French.

An agent calls `search_help` with a question's words, or reads the whole
guide from `draftloop://help/guide/en` or `/fr` as Markdown.

## How to test it

```sh
pnpm vitest run packages/ui/src/help-panel.test.tsx packages/user-guide apps/api/src/help-routes.test.ts apps/mcp/src/help.test.ts
```

The tests check that each language has every section, in order, that the
dialog renders them in English and French, and that common words in either
language find the right section, and that the API route and the MCP tool
return the guide to a signed-in member or an agent token.

## Surfaces

| Surface | What it does |
| --- | --- |
| Web header: **Help** | Opens the guide in a modal side sheet |
| `GET /v1/help`, `GET /v1/workspaces/:workspaceId/help` | The guide or a search of it, `language` `en` or `fr`, `q` up to 200 characters |
| MCP `search_help` (scope `journal`) | Searches the guide for an agent |
| MCP resources `draftloop://help/guide/en`, `/fr` | The whole guide as Markdown |
| `packages/user-guide/src/guide-en.ts`, `guide-fr.ts` | The guide's text, one module per language |
| `packages/user-guide/src/search.ts` | Word search over the guide, shared by the browser, the API and MCP |

## Limits

- Sections name the screens to open but do not link to them yet.
- Search matches words, not meaning; asking in your own words is #2882.
- Not on the sign-in and sign-up screens, which come before any record.

## Keeping it current

Each section names the feature pages it explains in `helpSectionFeatures`
(`packages/user-guide/src/guide.ts`). `pnpm lint:docs` fails when an available or
partial page in `docs/features/` is in no section. When you add a capability,
add or extend a section in both languages, then name its page there.

## Related

- [Display](../reference/display.md) for Guided, Simple and Show everything.
- [Feedback](feedback.md) when the guide does not answer a question.
