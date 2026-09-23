# Structural claim coverage

**Status:** Exit not met; captures improved from 37 to 28 issues
**Milestone:** [Structural claim coverage](https://github.com/akoita/draft-loop/milestone/14)
**Decision issue:** #482

This stage record contains only sanitized, content-free evidence. The three
captures from issue #476, their evidence, and the analysis scripts remain in the private
observation directory. Every measurement used the `capture-report` command or
local scripts that print only codes, flags, positions, and counts.

## Decision

The exit is **not met**. The rule was fixed in #482 before any fix was built:
uncovered blocks plus factual failures on the three #476 captures must fall by
at least half from 37, which means 18 or fewer. Every replay control must stay
rejected, and no factual, unsupported-claim, or required-section rule may be
weakened.

The captures reached 28. The other two conditions hold: all replay controls
are rejected, and no validation rule was weakened.

## Measured outcomes

| Issue | Change | Capture issues |
| ----- | ------ | -------------- |
| #479 | Repo-owned `capture-report` command, plus a fix for capture writer and reader drift that had made every real capture unreplayable | 37 (baseline reproduced) |
| #480 | Opening action verbs no longer joined to supported names, guarded by sentence structure | 34 (factual 7 → 4) |
| #481 | Claims completed for separated fields found verbatim in evidence, with numbers and ranges kept whole | 28 (coverage 30 → 24) |

Per capture, the totals moved from 11, 14, and 12 to 8, 12, and 8. No capture
was fully accepted.

The replay corpus grew to 64 invented cases. Every change kept all earlier
cases' results, and each added controls for the loosening it could cause:

- **#480:** inflated titles and "Led X is the employer" stay rejected.
- **#481:** absent fields, changed years, unsupported skills, split
  thousands, and split end years stay rejected.

## Why the remaining gap is author behaviour

A content-free diagnosis of every segment in the still-uncovered blocks found
that almost every such block contains at least one field that appears nowhere
in the candidate's evidence, even after dash normalization:

| Section | Remaining uncovered blocks | Main cause |
| ------- | -------------------------- | ---------- |
| Experience | 13 | Heading fields rewritten, or dates in another format |
| Summary | 3 | Prose not written as claims |
| Projects | 3 | Descriptions paraphrased |
| Skills | 3 | Items phrased differently from the evidence |
| Header | 2 | Contact fields not in the retrieved evidence |

Widening the search from cited to all retrieved chunks would complete almost
no additional block, because each still has an unmatched field. The four
remaining factual failures are the two renamed names and two absent values
classified in the [live observation](live-author-revalidation.md), all author
errors.

Further validator relaxation would therefore have to accept text that the
evidence does not contain, which the product rules forbid.

## Next stage

The next stage is **structured-block author guidance**. The author prompt
should require structured fields to be copied verbatim from evidence and
claimed field by field:

- heading roles, organisations, and dates;
- contact details;
- skills items.

Replay cannot measure author behaviour. The change must be measured in a new,
separately gated live observation on the unchanged case A inputs, with the
preflight and local capture, compared with #476 using `capture-report`.

That observation requires a new user authorization that names its issue.

## Limitations

- One case and three captures. The gain is measured on these drafts only.
- The segment diagnosis uses exact and dash-normalized matching. It does not
  prove that a paraphrased field is false, only that it is not verbatim.
