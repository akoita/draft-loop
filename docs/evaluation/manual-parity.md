# Manual parity

**Status:** Baseline and first observation recorded for reference A; references B to D unscored<br>
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
| 2026-10-06 | A   | Economy author and critic, full-source mode (all 181 eligible chunks), live source, sensitivity rules, default policy plus punctuation rules, 3 rounds; author ran without its model profile | 13 / 28 (46%) | 11 / 17 (65%) / 14 / 17 (82%)    | 0     | Markdown only; no headline; header without contact details | Not recorded         |

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

### First observation, reference A (2026-10-06, #878)

- Full-source mode sent every eligible chunk of the live career source, and
  13 sections the candidate marked never-share were withheld. A mechanical
  check found no text unique to those sections in the draft.
- Recall rose only from 39% to 46%. The author still left out much of the
  candidate's most relevant recent work, and an item present in round 1 was
  dropped in a later round. Input access no longer explains the gap; selection
  and editorial judgement do.
- The critic flagged factual scope only (an unsupported name, a credential
  scope, overstated ownership). It did not flag three policy violations that
  a human editor would catch: a personal-circumstance sentence, an internal
  annotation copied into the CV, and a credential dropped instead of moved.
- The deterministic relevance gate scored the draft 0 / 17 and also scores
  the reference CV 0 / 17, so it blocks the target outcome (#909).
- Caveats: the economy author ran without its model profile because the
  applied pair was not persisted (#907); the profile used by the run was
  derived before sensitivity rules existed in that workspace.
- Stage decision: the next gaps to address are an application plan
  (selection and framing against the job) and an editorial critic, with one
  frontier-author control run to separate model capability from workflow.
