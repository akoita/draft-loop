---
status: partial
---

# Feedback

A signed-in member sends a short note about DraftLoop to the operator: a bug,
an idea or anything else, through the API or their agent's `send_feedback`
tool. The operator reads every organisation's notes, newest first. The header
menu entry comes with #2844.

## Where it runs

Hosted and self-hosted servers in sign-in mode. Owner-token mode has no
members, so it takes no notes.

## How to use it

Send a note as a signed-in member:

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
covers the routes. The Postgres store and its erasure are tested in
`packages/storage-postgres/src/feedback-notes.test.ts`, which runs with
`DRAFT_LOOP_TEST_POSTGRES_URL` set.

## Surfaces

| Surface | What it does |
| --- | --- |
| `POST /v1/feedback` | A member sends a note: text up to 2,000 characters, an optional category (`bug`, `idea`, `other`) and the screen it came from |
| `POST /v1/workspaces/:workspaceId/feedback` | The same, for a member's agent token with the `journal` scope |
| `send_feedback` (MCP) | An agent passes on the candidate's note; its screen is `agent` |
| `GET /v1/operator/feedback` | The operator lists notes, newest first, 100 by default and at most 500 |

## Limits

- No header menu entry yet (#2844) and no operator screen yet.
- Notes are shown to the operator only and no model reads them, so they are
  not screened for hidden instructions.
- Erasing an organisation removes its notes. Erasing one candidate record does
  not, since a note belongs to the organisation.

## Related

- [Consent and erasure](organisations-and-consent.md)
