# Author correction reliability

**Status:** Exit met on the replay corpus; live author quality not validated
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
- The local driver already supports opt-in capture of rejected proposals
  (`authorProposalCaptureDirectory`), but the #456 run scripts did not enable
  it. Recovering the true failures needs another authorized observation with
  capture enabled; the pilot protocol now requires it.

## Replay baseline for the hypotheses

Issue #461 added twenty invented cases to the rejected-author replay corpus:
ten supported variants, each paired with a control that changes one real fact.
Each supported variant was written once, as the most natural form an author
would produce, and its current result was frozen without tuning.

The corpus now holds 26 cases: 11 accepted and 15 rejected. The six earlier
cases are unchanged. Their input bytes are identical, and the fixture SHA-256
changed from `13b57834…` to `7e9fcca1…` only because cases were appended.

| Hypothesis | Supported variants | Currently rejected | Controls rejected |
| ---------- | ------------------ | ------------------ | ----------------- |
| A. Opening prose coverage | 3 | 1 | 3 of 3 |
| B. Entry heading formatting | 4 | 0 | 4 of 4 |
| D. Evidence for list claims | 3 | 1 | 3 of 3 |

### Candidate false rejections

- **A, joining words.** A summary that joins two supported sentences with a
  relative word ("who") fails coverage, because only "and" is exempt. The code
  and position match the real class A rejections.
- **D, one claim per list value.** Splitting a skills list into one claim per
  value fails for a value with no token of three or more characters, such as
  "Go". The author guidance to split compound claims leads to this shape. The
  variant was written after reading the validator, so its result was
  predictable.

### Already handled

- **B is not supported.** Dash, spacing, "to" versus dash, present-tense
  endings, abbreviated months, and "at" versus comma headings are all
  accepted. Real class B rejections were therefore probably changed facts,
  which is an author error.
- **A:** claims spanning two sentences and whitespace-only or
  punctuation-only differences are accepted.
- **D:** partial citations are completed from retrieved evidence, and
  multi-chunk citations are accepted.

## Single-word name gap

Issue #466 tested whether an unsupported single-word proper noun is rejected.
It added eight invented cases: six controls and two supported cases. The gap
is confirmed.

| Case | Result |
| ---- | ------ |
| Tool substituted in a sentence | **Accepted** |
| Unsupported tool in a skills list | **Accepted** |
| Organisation substituted in a sentence | **Accepted** |
| Place substituted in a sentence | **Accepted** |
| Organisation substituted after "at" | Rejected (factual invariant) |
| Standalone unsupported tool | Rejected (unsupported claim) |
| Two supported cases naming the same word as the evidence | Accepted |

A single capitalised word is not a protected value unless it follows "at" or
"for". The only remaining guard requires one shared word of three or more
letters between a claim and its evidence. Any other matching word in the
sentence therefore lets a substituted tool, organisation, or place through.

This is a factuality gap in the validator, not an author-guidance problem. The
four accepted controls are pinned as known gaps, so a fix must change that
list deliberately. Every supported case in the corpus must keep its result.

### Gap closed

Issue #469 closes the gap. In a substantive claim, each capitalised single
word must now appear as a whole word, case-insensitively, in a cited chunk.
These are exempt:

- the first word of a sentence;
- words inside an already protected value;
- month and weekday names, `Present`, and `I`.

A possessive ("Globex's") is supported by its base name. A name found only in
a retrieved but uncited chunk gets that citation added, as protected values
already did.

All six #466 controls are now rejected. The other 30 earlier cases keep their
results, including both pinned #461 false rejections. Seven new invented
cases cover the exemptions, completion, and possessives:

- **Accepted:** calendar words, case differences, mid-list names,
  sentence-initial common words, uncited names that get a citation added, and
  possessives.
- **Rejected:** the uncited-name control.

A name substituted as the first word of a sentence is still not caught by this
rule.

## Joining-word coverage

Issue #470 lets a gap between two claim-covered spans pass coverage when it is
made only of joining phrases: `who`, `which`, `that`, `while`, `where`,
`with`, `including`, and `as well as`, optionally with "and". A gap with any
other word, or a joining word at the start or end of a block, stays uncovered.
The existing "and" exemption is unchanged.

The #461 joining-words case is now accepted. Its paired control is still
rejected for its changed fact, but no longer also for coverage, because its
only gap is "who". The other 39 earlier cases are unchanged:

- **Accepted:** two new supported cases ("while", "as well as").
- **Rejected for coverage:** two new controls ("who led", and an unclaimed
  trailing clause).

## Short names

Issue #471 adds a narrow fallback to the related-token check. A claim with no
token of three or more characters, such as a skills claim of just "Go" or
"R", is related only when every short capitalised token in it appears as a
case-sensitive whole word in its cited evidence. Claims with a longer token
behave exactly as before.

The #461 one-claim-per-value case is now accepted, and the pinned list of
supported cases the validator rejects is empty. The other 44 earlier cases
are unchanged:

- **Accepted:** a new supported "R" case.
- **Rejected with `unsupported_claim`:** two new controls, one where "Go"
  appears only as the lowercase verb and one where it is absent.

## Stage decision

Recorded under #462. The exit rule was fixed in that issue before the fixes:
at least one #461 supported case moves to accepted, every negative control
stays rejected, and no validation rule is weakened.

The exit is **met** on the replay corpus.

| Issue | Measured outcome |
| ----- | ---------------- |
| #459 | Rejected attempts record uncapped per-code counts beside the capped list |
| #460 | The #456 drafts were never saved; sixteen capped diagnostics gave four position-based hypotheses |
| #461 | Twenty invented cases; entry-heading formatting (B) already handled; two supported cases wrongly rejected |
| #466 | Confirmed that four unsupported single-word name controls were accepted |
| #469 | Unsupported single-word names now rejected; all six name controls rejected |
| #470 | Closed-set joining words pass coverage; the joining-words case accepted |
| #471 | Short names found verbatim pass the related check; the per-value case accepted |

The corpus now holds 48 invented cases: 24 accepted and 24 rejected. The two
supported cases from #461 that were wrongly rejected are now accepted, and the
pinned list of such cases is empty. Every control is rejected, which is 21
controls across #461, #466, #469, #470, and #471.

The factual gate is stronger than at the start of the stage, because #469
closes the single-word name gap. Two relaxations are bounded by explicit
controls:

- **#470:** gaps made only of the closed set of joining words, between two
  covered spans.
- **#471:** short names that appear verbatim in the evidence, in claims with
  no longer token.

### What the result does not show

- Every case is invented, and the supported variants were chosen from
  hypotheses, not from recovered drafts. The replay gain does not establish
  that a live author draft on a real case will now be accepted.
- The #456 class B and D rejections were probably genuine author errors,
  which these validator changes do not address.
- The unexplained author `api_error` remains an open risk for any live run.

### Next stage

The next stage is a new, separately gated live observation on the unchanged
case A inputs. It uses the #456 rules, runs the synthetic author preflight,
and captures rejected proposals locally so any failure can be re-validated
and classified from real structure. It requires a new user authorization that
names its issue.
