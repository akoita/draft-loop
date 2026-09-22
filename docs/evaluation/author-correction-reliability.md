# Author correction reliability

**Status:** In progress
**Milestone:** [Author correction reliability](https://github.com/akoita/draft-loop/milestone/12)

This stage record contains only sanitized, content-free evidence. Candidate
material, drafts, evidence text, prompts, and provider responses remain in the
private observation directories and were not read into any agent session.

## Structural classification of the #456 drafts

Issue #460 set out to re-run the production validator on the two rejected
author drafts from issue #456 and classify every failure by gate and position.

### What was available

A local inspection of the private #456 run history, printing only table names,
column names, row counts, status fields, and schema key names, found:

- **No saved proposals.** All three execution rows have an empty output. The
  rejected drafts were never persisted, so they cannot be re-validated and
  uncapped counts cannot be recovered.
- **No token usage.** Failed executions record zero input and output tokens.
- **Only capped diagnostics.** Each rejected attempt kept its first eight
  diagnostics in the persisted run error. That is sixteen code-and-path pairs
  across the two drafts, as recorded in the
  [retry observation](representative-author-draft-revalidation.md#retry-observation).

Following the #460 fallback, the classification below uses those sixteen pairs
only. Future rejections record uncapped per-code counts (#459), but still not
the rejected proposal itself.

### Classes by gate and position

Positions are structural paths, not content. Section indexes refer to the
draft's own section order, which was not saved.

| Class | Gate | Positions observed | Drafts |
| ----- | ---- | ------------------ | ------ |
| A. Opening prose without claim coverage | Substantive coverage | First block of sections 0 and 1 | Both |
| B. First claim of an entry block | Factual invariant | First claim of blocks 0, 12, and 13 in section 2 | Both (block 0 in both) |
| C. Uncovered text inside a long section | Substantive coverage | Blocks 0, 6, 11, and 17 of section 2 | Attempt 2 |
| D. Claim cites evidence that does not support it | Unsupported claim | Evidence references in sections 1 and 4 | Attempt 3 only |

Classes A and B recur at the same positions in both drafts, including after
structured retry feedback. They are the strongest candidates for replay cases.
Class D appeared only after retry feedback, which matches the finding that
feedback did not reduce rejections.

### Hypotheses for replay

The diagnostics cannot show whether each rejection was a validator false
rejection or a genuine author error. Each class therefore becomes a hypothesis
for #461 to test with invented content:

- **A:** a summary or headline paragraph written as prose, supported by
  evidence but not split into contiguous claims, is rejected for coverage.
- **B:** the first claim of an entry, typically a role, organisation, and date
  line, is rejected for a formatting-level mismatch with its evidence, such as
  a date-range or separator variant, rather than a changed fact.
- **D:** a claim in a list-style section cites a chunk that supports its topic
  but not its protected value.

For each hypothesis, #461 adds a supported invented variant that should be
accepted and a changed-fact control that must stay rejected. A hypothesis that
the validator already handles correctly becomes a genuine author error, and its
later fix targets author guidance rather than the validator.

### Limitations

- Sixteen capped diagnostics from one case are a thin basis. The classes show
  where rejections cluster, not why.
- The underlying text was not available locally and was never read, so no class
  is confirmed as a false rejection.
- Recovering the true failures would require saving rejected proposals locally
  and running another authorized observation. Neither is part of this issue.
