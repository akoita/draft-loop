# Manual parity

**Status:** Observations recorded for references A, E and F to I; references B to D unscored<br>
**Issue:** [#870](https://github.com/akoita/draft-loop/issues/870), part of
[#869](https://github.com/akoita/draft-loop/issues/869)

DraftLoop is meant to replace a manual loop in which a candidate passes a
resume between two frontier coding agents until both agree it is ready to
send. This page defines how a DraftLoop draft is compared with the CV that
loop produced for the same job post, and records the scores.

## Reference set

Nine private reference applications, each a job post plus the CV the manual
loop produced from the same career source:

| Ref | Role family                           |
| --- | ------------------------------------- |
| A   | Individual-contributor engineering    |
| B   | Individual-contributor engineering    |
| C   | Individual-contributor engineering    |
| D   | Engineering leadership                |
| E   | Individual-contributor engineering    |
| F   | Individual-contributor engineering    |
| G   | Individual-contributor engineering    |
| H   | Individual-contributor engineering    |
| I   | Individual-contributor engineering    |

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
| 2026-10-11 | E   | Development author (Mistral Large 4) and economy critic (GPT-6 Luna), full-source mode (all 282 eligible chunks), 3 rounds | 20 / 22 (91%) | 12 / 17 (71%) / 14 / 17 (82%)    | 0     | Markdown only; headline and contact header present | Not recorded         |
| 2026-10-14 | E   | Standard pair (Claude Opus 5.5 author, GPT-6.1 Sol critic), full-source mode (282 of 282 chunks, 0 of 764 profile facts), author prompt v7, coverage judgement v1, 3 rounds | 19 / 22 (86%) | 11 / 17 (65%) / 14 / 17 (82%)    | 0     | Markdown only; headline, contact header and core areas present | Not recorded         |
| 2026-10-14 | E   | As above with coverage judgement v2 (every uncovered requirement judged against the whole draft, #1209) | 18 / 22 (82%) | 11 / 17 (65%) / 14 / 17 (82%)    | 0     | Markdown only; headline, contact header and core areas present | Not recorded         |
| 2026-10-29 | F   | Balanced pair (Claude Sonnet 5.5 author, GPT-6.1 Terra critic), self-hosted stack, author prompt v16, 1 round | 20 / 34 (59%) | 11 / 13 / 11 / 13                | 0     | Shorter than the reference                   | Not recorded         |
| 2026-10-29 | G   | As F, Balanced pair                                                                 | 14 / 34 (41%) | 9 / 12 / 11 / 12                 | 0     | Shorter than the reference                   | Not recorded         |
| 2026-10-29 | H   | As F, Balanced pair                                                                 | 17 / 40 (43%) | 9 / 15 / 11 / 15                 | 0     | Shorter than the reference                   | Not recorded         |
| 2026-10-29 | I   | As F, Balanced pair                                                                 | 16 / 38 (42%) | 14 / 19 / 16 / 19                | 0     | Shorter than the reference                   | Not recorded         |
| 2026-10-29 | F   | Standard pair (Claude Opus 5.5 author, GPT-6.1 Sol critic), otherwise as above       | 25 / 34 (74%) | 11 / 13 / 11 / 13                | 0     | About the reference length                   | Not recorded         |
| 2026-10-29 | G   | As F, Standard pair                                                                 | 20 / 34 (59%) | 11 / 12 / 11 / 12                | 0     | About the reference length; passes every check | Not recorded       |
| 2026-10-29 | H   | As F, Standard pair; the critic stopped on spent OpenAI credit                      | 24 / 40 (60%) | 10 / 15 / 11 / 15                | 0     | About the reference length                   | Not recorded         |

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

### Observation, reference E (2026-10-14, #1172)

Reference E is a smart-contract engineering role at a market operator. Its 17
requirements include 10 responsibilities, which have counted as requirements
since #1171. The accomplishment list (22 items) and the per-draft verdicts are
frozen in the private folder.

- **Inputs were complete.** Both standard-pair runs sent every eligible chunk
  (282 of 282) to the author and recorded it (`run.author-input`, #1190).
  Profile facts are not sent in full-source mode by design.
- **Operational blockers came first.** The first two standard-pair runs failed
  before any draft: the CLI session's 120-second per-call limit cut the Opus
  author off at 2 minutes, and on Windows the timeout surfaced as an unknown,
  non-retryable error (#1196, fixed by #1198). A successful author step took
  166 seconds.
- **The frontier pair writes cleaner but selects less.** Against the economy
  draft it removed the writing defects the editorial critic targets (copied
  working notes, negative asides, noun fragments, a repeated line) and added a
  tailored core-areas section. It recalled fewer accomplishments (18 to 19 of
  22 against 20 of 22) and covered no more requirements (11 of 17 against
  12 of 17).
- **The deterministic coverage gate misread tailored prose.** Token matching
  left 15 of 17 requirements uncovered and relevance at 0.22 on a CV the
  scorer judged 11 of 17. Judging every uncovered requirement against the whole
  draft (#1209) raised the run's judged coverage from 3 to 8 requirements and
  relevance to 0.51, and removed every blocking coverage finding.
- **What remains is authoring, not access.** The run-6 critic judged 9
  requirements uncovered. The scorer agrees on most: four AI-assisted
  engineering responsibilities and the tokenisation engine are absent although
  the career source supports part of them, and the reference CV states them.
  The round-3 revision also dropped a line that had covered token standards in
  round 2, which cost a requirement the earlier draft covered.
- **Stage decision:** the gap that matters most is the author acting on judged
  coverage. Revisions now receive the critic's verdicts (#1211) and are warned
  when they drop a covering line (#1212). The next observation on reference E
  confirms whether recall and requirement coverage rise. Model choice is not
  the limiting factor: the economy draft recalled as much, and its defects are
  what the editorial critic already catches.

### Observation, references F to I (2026-10-29, #1307)

References F to I are four recent individual-contributor engineering
applications. Their accomplishment lists (34 to 40 items) and per-draft
verdicts are frozen in the private folder. Each reference CV was written from
an earlier version of the same career source, so recall may read high.

- **The default Balanced draft is not sendable.** It recalled 41 to 59% of the
  accomplishments in 763 to 1,291 words, against 1,540 to 1,656 for the
  reference CVs. It matched the reference's requirement coverage on one
  reference only. Every run stopped after round 1 on blocking findings,
  because the hosted service did not keep autopilot.
- **The Standard draft is close.** At about the reference length it recalled
  59 to 74% and matched the reference's coverage on two references. Reference
  G passed every final check. Reference I produced no draft.
- **Opus ran out of room.** Four of seven Opus draft calls stopped at the
  profile's 32,768-token output cap. The worker retried them, and the run's
  recorded cost left those billed calls out.
- **The relevance gate was too strict.** Drafts scored 0.31 to 0.57 against
  the 0.80 threshold. The coverage judge was harsher than the scorer on 14
  requirements across six drafts, all with evidence in the draft and most of
  them behavioural or seniority requirements.
- **Writing defects remain.** Copied working notes in the third person, a
  negative aside, fragment bullets and a repeated sentence.
- **Stage decision:** a quality sprint
  ([milestone 61](https://github.com/akoita/draft-loop/milestone/61)) gives
  Opus a 64,000-token cap (#1966), counts billed failed calls (#1967), keeps
  autopilot on hosted runs (#1969), judges demonstrated behaviour as coverage
  (#1970) and asks the author for a full first draft (#1971). References F to
  I are scored again on both pairs after it. The exit bar is unchanged: three
  of four references at 85% recall or more, coverage at least the
  reference's, no leaks.
