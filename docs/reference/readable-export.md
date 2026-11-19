# Readable export

The readable export is the copy a person opens to see their data. **Download
everything** under Your data saves it as `draftloop-data.zip`. Owners and
admins download it from `GET /v1/workspaces/{workspaceId}/export`.

The [record archive](record-archive.md) stays the complete, checkable copy of
every stored row. Use the readable export to hand a person their data, and the
archive to move or audit a record.

## Layout

| Path                                                 | Holds                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `README.md`                                          | When the copy was made, and what each file or folder holds                                                     |
| `account.json`                                       | The format, its version, when the copy was made and when the job search started                                |
| `consent-history.json`                               | Every consent given or withdrawn: kind, action, basis, who recorded it, providers, note and time               |
| `profile.md`, `profile.json`                         | The latest version of each career profile: each fact's category, field and value, and the quotes it comes from |
| `documents/<name>`                                   | The latest version of each added file, under the name the person gave it                                       |
| `applications/<name>/job.md`                         | The application's job text, or its job page address and the text fetched from it                               |
| `applications/<name>/<kind> <date>.md`               | Each saved cover letter, interview question set or interview guide                                             |
| `applications/<name>/exports/CV <date> <time>.<ext>` | Each exported CV, as it was exported, named by when it was made (UTC)                                          |
| `other drafts/`                                      | Saved drafts and exports whose application no longer exists                                                    |
| `journal.md`, `journal.json`                         | The work journal's pending and approved notes                                                                  |
| `profile-suggestions.json`                           | Suggested career profile changes: the change, the quote, who said it, where it was found and the outcome       |

Names are made safe as file names on Windows, macOS and Linux, and a repeated
name gets a number in brackets, such as `(2)`, before its extension. A file or folder the record has
nothing for is left out.

## What it never holds

Each file is built from a list of allowed fields, not from stored rows. So it
never holds:

- storage locations, tenant ids, shared counters, checksums or hash chains;
- agent token ids, screening results or member ids;
- fact, subject and source ids, and the model and prompt version that built
  the profile;
- run internals: rounds, executions, findings, orchestrator state, retrieval
  traces or the audit trail;
- discarded or merged journal notes;
- another record's data, or another organisation's.

## Checks

Each document's bytes are checked against the checksum and size stored for it,
before the download starts and again as they are written. A document that is
missing or changed fails the download with 409 `archive_integrity`, or ends a
download already under way without a valid zip.
