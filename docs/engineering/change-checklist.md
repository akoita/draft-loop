# Change checklist

Run through this list before you open a pull request. Each line names a place
that a small change can quietly break. In the PR body, say which lines applied
and what you deferred, under the template's impact sections.

## Boundaries

- [ ] Domain logic stays in `packages/*`. `apps/*` are adapters, and the
      dependency rules in [AGENTS.md](../../AGENTS.md#architecture-boundaries)
      still hold.
- [ ] New logic lives in a feature module, not in a frozen hotspot file.
      `pnpm architecture:hotspots` fails on growth; when you shrink a hotspot,
      lower its limit in `scripts/architecture-hotspots.mjs`.
- [ ] No provider SDK call outside `packages/providers` and
      `packages/model-gateway`.

## Contracts

- [ ] Persisted or exchanged data has a Zod schema in `packages/schemas`.
- [ ] An API change regenerates `apps/api/openapi.json` and the web's types
      ([Add an API route](api-route.md)).
- [ ] Both storage drivers move together: the SQLite driver in
      `packages/storage` and the Postgres driver in `packages/storage-postgres`.

## People and data

- [ ] Every new screen string goes through Lingui, in English and French;
      `pnpm i18n:check` passes ([Add a shared screen](shared-screen.md)).
- [ ] Material sent to a provider respects sensitivity tiers, screening and,
      in sign-in mode, the candidate's consent
      ([Sensitivity and screening](../features/sensitivity-and-screening.md)).
- [ ] Logs carry ids, never candidate material.
- [ ] Fixtures, tests and docs use fictional people, employers and jobs only.
- [ ] Model and provider identities are recorded; no claim, date or metric is
      invented.

## Agents

- [ ] A capability an agent could use is considered for an MCP tool in
      `apps/mcp`. An agent token reaches only the routes `request-auth.ts`
      allows it.
- [ ] A new MCP tool is named in its row's **Agent access** cell.

## Docs and release

- [ ] The [feature catalog](../features/README.md) row and its page are
      updated; `pnpm lint:docs` checks them.
- [ ] Reference pages, architecture pages and the roadmap say what is true now.
- [ ] A milestone's last PR updates `server-release.json`.

## Checks

Run the focused tests of the packages you changed while you work. Before the
PR, run the full gate once:

```sh
pnpm format && pnpm validate
```

Paid model runs need the owner's go and a named cost cap. Tests use scripted
fakes or demo mode, which call no provider.
