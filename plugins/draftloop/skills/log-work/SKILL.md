---
name: log-work
description: Record notable work merged in a date range into the DraftLoop work journal, for the candidate's review.
---

# Log notable work

Use this when the candidate asks to log work, optionally with a date range such as "since 2026-10-01" or "last week". Without a range, use the last 14 days.

1. List what was merged in the range from the local git history, on the default branch:

   ```text
   git log --first-parent --since=<from> --until=<to> --date=short --pretty="%h %ad %s"
   ```

2. Group the commits into pieces of work, by pull request number or by feature.
3. Keep only notable work, by the rule in `draftloop://work-journal/guide`: shipped features, integrations, migrations, adopted technologies and measured improvements. Drop typo fixes, formatting, dependency bumps and refactors without an outcome.
4. Call `list_work` for the project, and skip work that is already recorded.
5. Call `record_work` once per remaining piece, with the commit or pull request links as https links. Ask the candidate when their role or the project's visibility is unclear.
6. Say what you recorded and what you skipped. The notes wait for the candidate's review in DraftLoop.

Never include keys, tokens, passwords, customer or personal data, or private document text.
