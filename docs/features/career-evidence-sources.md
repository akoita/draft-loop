---
status: available
---

# Career evidence sources

Career evidence is the material every draft is grounded in: your own files,
text you paste and the pull requests you merged. This page is for a candidate
adding evidence and for a developer changing how it is taken in.

## Where it runs

On every server: self-hosted, hosted and the desktop client over it. The
source-only CLI takes files into a local workspace instead
([CLI and desktop reference](../reference/cli-and-desktop.md)).

## How to use it

1. Open **Career evidence** and choose **Add documents**. DraftLoop takes PDF,
   DOCX, Markdown and text files, and pull request lists as JSON or CSV.
2. Or choose **Paste text**, give an optional title and save. The text is
   stored as one more source, named `<title>.txt`.
3. **Your files** lists each source with the date it was added, its
   injection screening and a **Download** button.

Every source is screened for hidden instructions before a run may use it; see
[Sensitivity and screening](sensitivity-and-screening.md). Imported pull
requests start `sensitive`, with one private-section rule per repository that
you can lower to **Always allow**.

## How to test it

- Walk steps 2 and 3 of the [local server stack](../operations/local-server-stack.md)
  with fictional files; the stack calls no provider.
- Focused tests: `apps/api/src/knowledge-routes.test.ts`,
  `packages/ui/src/career-evidence-card.test.tsx` and
  `apps/web/src/evidence-panels.test.tsx`.

## Surfaces

| Kind   | Surface                                                                    |
| ------ | -------------------------------------------------------------------------- |
| Screen | Career evidence card and **Your files** panel                              |
| API    | `GET`/`POST /v1/knowledge-bases/{id}/sources`                              |
| API    | `GET /v1/knowledge-bases/{id}/sources/{sourceId}/file` (download)          |
| API    | `PUT /v1/workspaces/{id}/knowledge-selection` (bases a run uses)           |
| MCP    | none; the [work journal](../reference/agent-channel.md) adds notes instead |

## Limits

- A download returns the latest version only. A pull request list returns the
  Markdown it was stored as, not the original JSON or CSV.
- A member cannot download quarantined material; an owner or admin can.
- Sources cannot be edited or deleted from the screen yet.

## Related

- [Candidate evidence architecture](../architecture/candidate-evidence.md)
- [Career profile](career-profile.md), built from these sources
