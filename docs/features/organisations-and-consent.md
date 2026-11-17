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

1. An operator creates an organisation and invites its first owner, or, on
   the public beta, sends a person an invite code that creates their own
   organisation on first sign-in. Sign-up asks the person to accept the
   current terms of use and privacy policy, which say that drafting sends
   material to providers outside the EU, and records the accepted version.
   A visitor without a code can join the waitlist, and the operator turns
   an entry into an invite. Owners
   and admins invite people by email; each active member or pending invitation
   takes a seat.
2. Assign members to the candidate records they work on. A member reaches only
   their assigned records.
   A record keeps the id it was created with. Anyone who reaches it can give
   it a plain name of up to 80 characters with
   `PUT /v1/workspaces/{id}/name`; the records list returns that name, and a
   record without one is shown by its id. Erasing the record removes the name.
   On the web, **New job search** asks for the name only: the screen makes the
   id from it and saves the name once the record is set up.
3. Check who you are and which team you act for in the account menu at the
   start of the top bar. The screen calls the organisation your team and a
   candidate record a job search; see [What the screen shows](#what-the-screen-shows).
4. Record the candidate's two consents under **Credits and consent**: to store
   their material, and to send it to model providers. Uploads need the first.
   Runs need the second, naming both the writer's and the reviewer's
   companies. A profile derivation and a requirements extraction call only the
   writer's model, so they need the writer's company; on the web, the
   profile's send approval records it. When a run needs a company the consent
   does not name, the permission box offers the consent form again; the new
   grant replaces the old one without a withdrawal. A withdrawal is recorded
   too, and the history is kept.
5. Owners download a record's [archive](../reference/record-archive.md), erase
   one record, or delete the whole organisation.

## What the screen shows

The screen reads the plan's limits from `GET /v1/me`, never its name.

| Plan allows                    | Account menu                        | Above Home                                                       |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------------- |
| One job search and one seat    | Email; Your data (download, delete) | Nothing: the job search opens or is created as **My job search** |
| Several job searches, one seat | Email                               | **Working on** picker and **New job search**                     |
| Several seats                  | Email and team name                 | Picker, plus **Who can open this job search**                    |

An organisation that already holds two job searches keeps the picker after a
change to a one-person plan, so none is hidden. Nobody can remove their own
access from the screen.

## Operator screen

The operator runs the beta from **Operator** in the web screen. A named
operator finds it in the account menu; owner-token mode shows it in the top
bar. Nobody else sees it: the screen offers it only when `GET /v1/me` answers
`kind: owner` or `operator: true`.

| Section  | What it shows                                                                  |
| -------- | ------------------------------------------------------------------------------ |
| Waitlist | Entries newest first. **Invite** turns one into an invite and shows its code once |
| Invites  | Each invite, sent, redeemed or revoked, and the beta accounts used and left    |
| Feedback | Members' [notes and support tickets](feedback.md), newest first, read only     |

Send the code to the person yourself: DraftLoop sends no email. Each invite is
written to the audit log under the operator's sign-in.

## How to test it

- Focused tests: `apps/api/src/organisation-routes.test.ts`,
  `apps/api/src/plan-limits-routes.test.ts`, `apps/web/src/records.test.tsx`,
  `apps/web/src/records-model.test.ts`, `apps/web/src/account-menu.test.tsx`,
  `apps/api/src/beta-sign-up-routes.test.ts`, `apps/web/src/beta-sign-up.test.tsx`,
  `apps/api/src/consent-routes.test.ts`,
  `apps/api/src/record-erasure-routes.test.ts` and
  `apps/web/src/consent.test.tsx`.
- The operator screen: `apps/web/src/operator.test.tsx`, and
  `apps/api/src/request-auth.test.ts` for refusing a member without the role.
- `pnpm test:postgres` adds the tenant isolation, consent enforcement and
  erasure suites.

## Surfaces

| Kind   | Surface                                                                                       |
| ------ | --------------------------------------------------------------------------------------------- |
| Screen | Account menu, job search picker, who can open it, Credits and consent, beta sign-up           |
| Screen | Operator: waitlist, invites and feedback                                                      |
| API    | `/v1/organisation`, `/v1/organisation/members`, `/v1/me`                                      |
| API    | `POST /v1/sign-up`, `/v1/operator/beta-invites`, `POST /v1/waitlist`, `/v1/operator/waitlist` |
| API    | `/v1/workspaces/{id}/members`, `/v1/workspaces/{id}/consents`                                 |
| API    | `/v1/workspaces/{id}/archive`, record and organisation erasure                                |
| MCP    | none                                                                                          |

## Limits

- Operator routes take the owner token, or a named operator's sign-in that
  holds the `draft-loop-operator` role and used a second factor
  ([setup](../operations/server-deploy.md#sign-in-as-a-named-operator)).
- The operator screen revokes no invite; use
  `DELETE /v1/operator/beta-invites/{inviteId}`. Invites do not expire.
- Consent covers one candidate record; each record records its own.

## Related

- [Storage and tenancy architecture](../architecture/storage-and-tenancy.md)
- [Privacy policy](../legal/README.md) and
  [processing register](../legal/processing-register.md)
- [Plans and credits](plans-and-credits.md)
