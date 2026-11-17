---
status: partial
---

# Feedback

A signed-in member sends a short note about DraftLoop to the operator: a bug,
an idea or anything else, from the **Send feedback** button in the web
header, through the API or through their agent's `send_feedback` tool. The
operator reads every organisation's notes, newest first.

## Where it runs

Hosted and self-hosted servers in sign-in mode. Owner-token mode has no
members, so it takes no notes.

## How to use it

In the web screen, select **Send feedback** in the header, pick a kind of
note if you know it, write it and select **Send**. The screen you are on is
sent with the note.

Send a note through the API as a signed-in member:

```sh
curl -X POST "$DRAFT_LOOP_URL/v1/feedback" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "The export button does nothing.", "category": "bug", "screen": "review"}'
```

The answer is `201` with the stored note. Read the notes with the owner token:

```sh
curl "$DRAFT_LOOP_URL/v1/operator/feedback?limit=50" -H "Authorization: Bearer $OWNER_TOKEN"
```

## How to test it

`pnpm --filter @draft-loop/api exec vitest run src/feedback-routes.test.ts`
covers the routes, and `pnpm --filter @draft-loop/web exec vitest run
src/feedback.test.tsx` covers the dialog. The Postgres store and its erasure are tested in
`packages/storage-postgres/src/feedback-notes.test.ts`, which runs with
`DRAFT_LOOP_TEST_POSTGRES_URL` set.

## Surfaces

| Surface | What it does |
| --- | --- |
| Web header: **Send feedback** | A dialog for the note and its kind, in sign-in mode only |
| `POST /v1/feedback` | A member sends a note: text up to 2,000 characters, an optional category (`bug`, `idea`, `other`) and the screen it came from |
| `POST /v1/workspaces/:workspaceId/feedback` | The same, for a member's agent token with the `journal` scope |
| `send_feedback` (MCP) | An agent passes on the candidate's note; its screen is `agent` |
| Web: **Operator**, Feedback | The operator reads notes and tickets, newest first ([operator screen](organisations-and-consent.md#operator-screen)) |
| `GET /v1/operator/feedback` | The operator lists notes and support tickets, newest first, 100 by default and at most 500. A ticket has kind `support` and its shared `transcript` |
| `POST /v1/workspaces/:workspaceId/support/conversations/:conversationId/handoff` | A member hands a support conversation to a person, with consent: it becomes a support ticket |

## Limits

- Support tickets are deleted 90 days after they were sent, by the worker's sweep at each start. Notes stay until their organisation is erased.

- The operator reads notes on the
  [operator screen](organisations-and-consent.md#operator-screen) or through
  the API, and cannot answer them from DraftLoop.
- Notes are shown to the operator only and no model reads them, so they are
  not screened for hidden instructions.
- Erasing an organisation removes its notes. Erasing one candidate record does
  not, since a note belongs to the organisation.

## Related

- [Consent and erasure](organisations-and-consent.md)
