---
name: From feedback
about: Turn a member's feedback note into an issue, anonymised
title: "[Feedback]: "
labels: []
---

<!--
For the operator, after reading a note with `GET /v1/operator/feedback` or the
`list_feedback` tool. This issue is public: it never holds the member's words,
email or name, nor their organisation or member id. Write the problem in your
own words. Once the issue exists, link it to the note with
`PATCH /v1/operator/feedback/:noteId` or the `triage_feedback` tool.
-->

## Summary

<!-- What the member ran into, in your own anonymised words. One or two sentences. -->

## Technical context

<!--
Paste the note's `context` from the operator list: page, web build, server
release, plan, recent API error codes, last failed request id and coarse browser
facts. Leave out `ids`: the record, application and run stay with the note.
-->

```json

```

## Note

- Note id: <!-- the note's noteId -->
- Kind: <!-- bug, idea or other -->

This issue never holds the member's words, email or name.
