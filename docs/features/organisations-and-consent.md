---
status: available
---

# Organisations and consent

On the hosted service, people work in an organisation. Members are assigned to
candidate records, and nothing about a candidate is stored or sent to a model
provider without that candidate's recorded consent. This page is for an owner
or admin managing an organisation and a developer touching tenancy or consent.

## Where it runs

The hosted service in sign-in mode. A self-hosted server has one owner and no
organisation; it erases everything with `draft-loop-server`
([Self-hosted server](../operations/self-hosted.md#update-and-erase)).

## How to use it

1. An operator creates an organisation and invites its first owner. Owners
   and admins invite people by email; each active member or pending invitation
   takes a seat.
2. Assign members to the candidate records they work on. A member reaches only
   their assigned records.
3. Record the candidate's two consents under **Credits and consent**: to store
   their material, and to send it to model providers. Uploads need the first;
   runs and profile derivation need the second. A withdrawal is recorded too,
   and the history is kept.
4. Owners download a record's [archive](../reference/record-archive.md), erase
   one record, or delete the whole organisation.

## How to test it

- Focused tests: `apps/api/src/organisation-routes.test.ts`,
  `apps/api/src/consent-routes.test.ts`,
  `apps/api/src/record-erasure-routes.test.ts` and
  `apps/web/src/consent.test.tsx`.
- `pnpm test:postgres` adds the tenant isolation, consent enforcement and
  erasure suites.

## Surfaces

| Kind   | Surface                                                        |
| ------ | -------------------------------------------------------------- |
| Screen | Credits and consent, organisation members                      |
| API    | `/v1/organisation`, `/v1/organisation/members`, `/v1/me`       |
| API    | `/v1/workspaces/{id}/members`, `/v1/workspaces/{id}/consents`  |
| API    | `/v1/workspaces/{id}/archive`, record and organisation erasure |
| MCP    | none                                                           |

## Limits

- Sign-in uses Keycloak, which is not hosted yet, so staging signs in with the
  owner token.
- Consent covers one candidate record; each record records its own.

## Related

- [Storage and tenancy architecture](../architecture/storage-and-tenancy.md)
- [Privacy policy](../legal/privacy-policy.md) and
  [processing register](../legal/processing-register.md)
- [Plans and credits](plans-and-credits.md)
