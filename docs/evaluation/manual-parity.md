# Manual parity

**Status:** Baseline recorded for reference A; references B to D unscored<br>
**Issue:** [#870](https://github.com/akoita/draft-loop/issues/870), part of
[#869](https://github.com/akoita/draft-loop/issues/869)

DraftLoop is meant to replace a manual loop in which a candidate passes a
resume between two frontier coding agents until both agree it is ready to
send. This page defines how a DraftLoop draft is compared with the CV that
loop produced for the same job post, and records the scores.

## Reference set

Four private reference applications, each a job post plus the CV the manual
loop produced from the same career source:

| Ref | Role family                           |
| --- | ------------------------------------- |
| A   | Individual-contributor engineering    |
| B   | Individual-contributor engineering    |
| C   | Individual-contributor engineering    |
| D   | Engineering leadership                |

The job posts, reference CVs, drafts and accomplishment lists stay in a
private local folder outside the repository. This page carries scores and
content-free observations only: no candidate, employer, project name or
private URL.

## Scores

Each scored draft gets five measures.

| Measure                    | How it is scored                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key-accomplishment recall  | The scorer lists the reference CV's job-relevant accomplishments once per reference. A draft counts one only when it states it as an accomplishment; a technology named in a list does not count. |
| Requirement coverage       | Share of the job post's requirements with at least one CV statement that substantially supports it, judged by the scorer rather than token matching. The reference CV is scored the same way. |
| Leaks                      | Statements taken from material the candidate marked as interview-only or never-share.                                                                  |
| Format fit                 | Sections and page target required by the candidate's writing rules, and the delivered file format.                                                     |
| Edits before sending       | Number of changes the candidate would still make before sending, recorded by the candidate.                                                            |

Recall and requirement coverage are scorer judgments, so each record names the
scorer. The accomplishment list for a reference is frozen once written, so
later drafts are scored against the same list.

## Results

| Date       | Ref | Draft configuration                                                                 | Recall        | Requirements (draft / reference) | Leaks | Format fit                                   | Edits before sending |
| ---------- | --- | ----------------------------------------------------------------------------------- | ------------- | -------------------------------- | ----- | -------------------------------------------- | -------------------- |
| 2026-10-05 | A   | Economy author and critic, retrieval mode (20 excerpts), stale source copy, no policy, 3 rounds | 11 / 28 (39%) | 10 / 17 (59%) / 14 / 17 (82%)    | 1     | Markdown only; 5 required sections missing  | Not recorded         |

### Baseline observations, reference A

- The 17 missed accomplishments are concentrated in the candidate's most
  recent work, which is the most relevant material for the role, and in
  certifications and recognition. The author never received that
  material: retrieval passed 20 excerpts of a much larger career source.
- Every requirement the draft missed and the reference covered depends on
  that recent work.
- The one leak came from a part of the career source the candidate had
  marked as not for a CV. DraftLoop does not model those markings yet.
- Scorer: Claude Opus 5.5 in a DraftLoop maintenance session. Edits before
  sending await the candidate's count.
