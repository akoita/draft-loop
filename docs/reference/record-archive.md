# Record archive v1

A record archive holds everything the hosted service keeps about one candidate
record, so an organisation can hand the candidate their data or keep a copy
before deleting the record (ADR 0011, D7). The API serves it as a zip
download. The format is defined by the Zod schemas in
`@draft-loop/schemas/record-archive`.

## Layout

| Path | Holds |
| --- | --- |
| `manifest.json` | The format, its version, when the archive was made, the record's workspace id, and every other file with its SHA-256 and size |
| `tables/<table>.json` | The record's rows of one table, as `{ "table": ..., "rows": [...] }` |
| `objects/<sha256>` | The original bytes of one source version or exported document, named by their SHA-256 |

Table rows keep the service's column names and values. Text payloads keep their
stored text, so the checksums recorded beside them still verify them. Times
stored as timestamps are ISO 8601 text, and 64-bit integers such as sizes and
sequence numbers are decimal strings. Rows never carry the tenant column. A
table the record has no rows in is left out, and identical bytes are stored
once.

## What it holds

- **Settings:** the record's workspace settings documents, including its
  configuration and writing policy text.
- **Versions:** writing policy, profile and job brief versions.
- **Consents:** the record's whole consent ledger.
- **Applications and runs:** applications and their bindings, runs with their
  snapshots, rounds, step executions, findings, decisions and exports, the
  orchestrator's run state, retrieval traces and the record's audit trail.
- **Knowledge:** knowledge bases with their sources, source versions and
  sensitivity rule versions. In sign-in mode these are the bases the record
  owns. In owner-token mode, which holds one workspace and organisation-wide
  bases, they are every base the organisation holds.
- **Objects:** the bytes of every source version of those bases and of every
  exported document.

## What it never holds

- Credentials, keys or tokens.
- Another record's data, or another organisation's. Organisation-wide
  knowledge bases are included only in owner-token mode, which has one record.
- The organisation's member directory, or which members a record is assigned
  to.
- Provider request bodies, idempotency results, and search indexes derived
  from the sources.

## Checks

Each object's bytes are checked against the checksum and size its row recorded
before they are written. An object that is missing or changed fails the
archive; it is never written unchecked.

## Relation to the portable backup

The archive is not the local version's portable knowledge backup (ADR 0007),
which holds one knowledge store without runs or consents. Converting between
them belongs to importing a local workspace (ADR 0011, D12).
