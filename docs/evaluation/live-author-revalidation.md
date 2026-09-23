# Live author revalidation

**Status:** Failed; all three drafts rejected; captured proposals analysed content-free
**Milestone:** [Live author revalidation](https://github.com/akoita/draft-loop/milestone/13)
**Observation issue:** #476
**Revision:** `2c1f8374bb51e2eb6a1635176ba9c17c9b2d0123`

This record contains only sanitized, content-free evidence. Candidate material,
drafts, evidence text, prompts, provider responses, the consent record, and
paths remain in the private observation directory. No agent session read the
captured proposal or evidence text; local scripts printed only codes, paths,
section kinds, flags, and counts.

## Admission and bounds

The candidate authorized #476 in their own words: both sign-in probes, one
synthetic author preflight, and one bounded run on the unchanged case A
material with local capture of rejected proposals, using the same models and
bounds as #446 and #456 and stopping at their first review.

Both probes passed. The synthetic preflight on `claude-sonnet-4-5` returned
`available` before any candidate material was sent. The driver saved every
rejected author proposal to a private directory with mode 0700.

## Attempts

| Attempt | Result | Active provider time | Uncapped diagnostic counts |
| ------- | ------ | -------------------- | -------------------------- |
| 1 | Retryable local rejection | 457,380 ms | 10 substantive-coverage, 1 factual-invariant |
| 2 | Retryable local rejection | 324,989 ms | 10 substantive-coverage, 4 factual-invariant |
| 3 | Final local rejection | 230,828 ms | 10 substantive-coverage, 2 factual-invariant |

Total active provider time was 1,013,197 milliseconds, and accounted duration
was 1,027,651 milliseconds. No provider error occurred, so no
`claude_api_error_*` cause code applies. No critic call, first review,
approval, or export occurred. Provider-reported cost was unavailable.

## Result

The observation **fails** under the rules fixed in #476. The validator rejected
every attempt, and each attempt produced a draft. The rules were not changed
after the result.

## Content-free analysis of the captured drafts

All three drafts used the same eight section kinds: header, summary,
experience, projects, education, certifications, skills, and languages.
Re-running the production validator on each capture reproduced the recorded
counts exactly.

### Coverage failures

Each attempt had exactly ten blocks with uncovered substantive text, in stable
positions:

| Section | Blocks per attempt | Shape |
| ------- | ------------------ | ----- |
| Header | 1 | Short contact line with separators; claims missing or marked non-substantive |
| Summary | 1 | Long prose paragraph; 40, 49, then 7 uncovered words across attempts |
| Experience | 6 | Mostly short heading lines with separators, uncovered at the start |
| Projects | 1 | Heading or bullet partly claimed |
| Skills | 1 | List paragraph; 12–27 uncovered words, in one attempt with no claims |

In the heading, header, and skills blocks, no uncovered word appears in any
claim of the block. The author omitted claims for those fields rather than
paraphrasing them. The summary improved sharply after retry feedback, so
structured feedback works for prose but not for these structural blocks.

### Factual failures

The validator completes missing citations before checking facts, so values
found elsewhere in retrieved evidence are not failures. Seven values were
absent from all retrieved evidence:

| Cause | Count | Classification |
| ----- | ----- | -------------- |
| Common action verb at claim start joined to a supported name | 3 | Validator false rejection |
| Two capitalised words, each in the evidence but not adjacent | 2 | Probable author renaming |
| A capitalised word absent from all evidence, beside a supported name | 1 | Author error |
| A number absent from all evidence | 1 | Author error |

None of the seven values appears in the full evidence corpus, so no failure is
caused by retrieval missing a chunk that contains the value.

## Stage decision

Recorded under #476. The fail rule applies, and captures exist, so the next
stage is a provider-free milestone seeded from this analysis:

1. **Opening verbs.** Stop joining a common opening action verb to a following
   supported name when extracting multi-word protected values. This is a
   validator false rejection covering three of seven factual failures.
2. **Structural claim coverage.** Heading lines, the header contact line, and
   skills lists fail because the author omits claims for their fields. Measure
   a deterministic completion that adds claims for fields found verbatim in
   cited or retrieved evidence, following the existing claim-coverage
   completion. The alternative is author guidance for structured blocks.
3. **Measurement.** Each change is measured on invented replay cases and, with
   the same content-free scripts, on the three private captures. The captures
   never leave the private directory.

No cohort is admitted. The two author-error classes remain for author guidance
or a later observation.

## Limitations

- One case and one run.
- The shape analysis uses content-free flags, so each class is a structural
  explanation, not a reading of the text.
- The "renaming" classification rests on both words appearing separately in
  the evidence. It could also be a genuine invention.
