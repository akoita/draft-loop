# Failure taxonomy

This page is for whoever runs or extends the labelled rounds behind the eval
suite (#1105, then #1107). It says how rounds are produced, how they are
labelled, and how the split works.

**Status:** labelled. 40 Economy rounds ran on 2026-11-22 and are labelled in
`packages/evaluations/fixtures/failure-taxonomy/labels.json`. See Results.

## Produce the rounds

The rounds use the fictional full-CV cohorts in
`packages/evaluations/fixtures/*-cohort/`: eight software cases and four
non-tech cases. Each round is one ordinary author–critic round on the Economy
pair.

```sh
# Free dry run with the deterministic offline agents
node scripts/failure-taxonomy-rounds.mjs --out ~/draft-loop-ftx-dry --fixture

# Paid run: needs the owner's go and a named cap
node scripts/failure-taxonomy-rounds.mjs --out ~/draft-loop-ftx \
  --preset economy --per-run-cap-usd 0.25 --total-cap-usd 3
```

- To sign in with the signed-in `claude` or `codex` CLI instead of an API key, export
  `DRAFT_LOOP_ANTHROPIC_AUTH_MODE=user-session` or `DRAFT_LOOP_OPENAI_AUTH_MODE=user-session`.
- `--out` must be outside the repository. Each round gets `round.json` with
  the run state, cost, draft and critic findings.
- The script stops before a round that could pass the total cap, and skips
  rounds that already have `round.json`, so it can resume.
- Software cases run three times, non-tech cases four times: 40 rounds.
- Keep the per-run cap at $0.25 or more. Each call reserves its worst case
  first (up to $0.16), so a lower cap can stop before the first call.

## Label the rounds

1. **Open-code.** Read each draft against its case's `expectations.json`
   and the source profile. Write one short note per problem seen.
2. **Group.** Merge the notes into named failure modes. Start from the
   codebook below and add a mode only when at least two rounds show it.
3. **Label.** For every round and every mode, record `pass` or `fail`.
   A round fails a mode when at least one instance appears in the draft.
4. **Critic agreement.** For each failure, record whether the critic flagged it.

| Mode | Fails when the draft |
| --- | --- |
| `unsupported-claim` | States a qualification, title, award or responsibility the source lacks (a `prohibitedClaims` hit) |
| `altered-number` | Changes a number, percentage, money amount, ordinal or date |
| `chronology-drift` | Merges periods, shifts dates or hides a recorded gap |
| `attribution-inflation` | Turns team, supervised or shared work into sole ownership or leadership |
| `scope-stretch` | Turns attendance, a booked course or partial evidence into a held credential |
| `must-cover-omission` | Leaves out a `mustCover` fact the job needs |
| `requirement-overclaim` | Presents an `unsupported` requirement as met |
| `no-draft` | Produces no admitted draft (validator rejection, budget stop, error) |

## Labels file

Labels go in `packages/evaluations/fixtures/failure-taxonomy/labels.json`.
They hold no draft text: only round ids, case ids, the split, one label per
mode, and whether the critic agreed.

## Split

The split is by case, so a case never sits on both sides.

| Split | Cases | Use |
| --- | --- | --- |
| train | c, d, e, f, nurse, electrician | Write and tune judges |
| dev | g, h, sales | Check judges while tuning |
| held-out | a, b, teacher | Measure once, never tune on it |

The reserved cohort (a, b) is the held-out side because its README forbids
tuning on its results.

## Record

The results section names the commit, the Economy author and critic profiles,
the author and critic prompt versions, the round count and the actual cost.

## Results

- Commit: `a5a61e34`.
- Author: `economy-anthropic-author@5` (`claude-haiku-5-5`), prompt
  `cli-author-v21`.
- Critic: `economy-openai-critic@1` (`gpt-6-luna`), prompt `cli-critic-v12`.
- Rounds: 40 (24 software, 16 non-tech). 38 ended awaiting approval. Two ended
  in a provider error; one of them has no draft.
- Cost: $2.14 in total. The 40 rounds cost $2.12. An earlier pilot lost to an
  expired OpenAI key cost $0.014 and is not labelled.

Two modes were added during grouping: `role-omission` (a whole dated role is
missing) and `placeholder-left` (`[Your name]` or `[Email]` left in the
header). "Critic flagged" counts any stored finding for the round, from the
critic model or the deterministic checks, that names the failure.

| Mode | Fail, all | Software | Non-tech | Critic flagged |
| --- | --- | --- | --- | --- |
| `unsupported-claim` | 0/40 | 0/24 | 0/16 | - |
| `altered-number` | 0/40 | 0/24 | 0/16 | - |
| `chronology-drift` | 26/40 (65%) | 19/24 (79%) | 7/16 (44%) | 4/26 |
| `attribution-inflation` | 2/40 (5%) | 2/24 (8%) | 0/16 | 2/2 |
| `scope-stretch` | 1/40 (3%) | 0/24 | 1/16 (6%) | 1/1 |
| `must-cover-omission` | 37/40 (93%) | 24/24 (100%) | 13/16 (81%) | 1/37 |
| `requirement-overclaim` | 0/40 | 0/24 | 0/16 | - |
| `no-draft` | 1/40 (3%) | 0/24 | 1/16 (6%) | 0/1 |
| `role-omission` | 19/40 (48%) | 15/24 (63%) | 4/16 (25%) | 4/19 |
| `placeholder-left` | 37/40 (93%) | 22/24 (92%) | 15/16 (94%) | 37/37 |

Observations:

- No round invented a credential, changed a number or claimed an unsupported
  requirement. The failures are omissions and misplaced facts.
- Drafts drop facts the job needs, most often languages, training scope,
  studies and side projects. The critic flagged this in 1 of 37 rounds.
- A whole role is often missing, and its work can move under another
  employer's dates. The critic caught 4 of 19 missing roles and none of the
  moved work.
- Recorded gaps are usually hidden. The critic's gap check fired in 4 of 26
  chronology failures.
- The deterministic header check caught every placeholder, and the critic
  caught both cases of team work stated as solo work.

## Deterministic scorer

`packages/evaluations/src/cohort-scorer.ts` (#3287) decides four modes from
the draft text and the case's own profile, with no model call. The model
judge (#3288, below) covers the rest.

| Mode | Fails when |
| --- | --- |
| `placeholder-left` | A bracketed placeholder such as `[Email]` is in the draft |
| `altered-number` | A number appears that neither the profile nor the job states |
| `role-omission` | A dated role's employer is not named, in full or by a short form |
| `chronology-drift` | A named role's start or end date is missing, or a recorded gap is neither named nor dated |

To measure it against the labels, from the repository root:

```sh
pnpm exec tsx packages/evaluations/src/cohort-scorer-command.ts ~/draft-loop-ftx
```

Agreement with the labels on the 39 rounds that have a draft:

| Mode | Train | Dev | Held-out |
| --- | --- | --- | --- |
| `placeholder-left` | 100% | 100% | 100% |
| `altered-number` | 100% | 100% | 100% |
| `role-omission` | 100% | 100% | 100% |
| `chronology-drift` | 95% | 100% | 70% |

- The one train miss is work listed under the wrong employer, which only the
  model judge can see.
- The three held-out misses came from a parsing bug: case b's gap id has no
  number. The fix only widens the id pattern, but it was found by looking at
  held-out results, so held-out is no longer a clean measure for this mode.

## Model judge

`packages/evaluations/src/cohort-judge.ts` (#3288) covers the four modes a
rule cannot decide. It sends the source profile, the draft and the case's
unsupported claims to a decision model, which answers each question with a
probability. Code turns probabilities into verdicts by threshold.

| Mode | Question | Fails when |
| --- | --- | --- |
| `must-cover-omission` | One per `mustCover` fact: the draft states it and keeps its meaning | Any fact is below the threshold |
| `attribution-inflation` | Shared, supervised or someone else's work becomes the candidate's own | The probability reaches the threshold |
| `scope-stretch` | Attended, booked or partial evidence becomes a held credential | The probability reaches the threshold |
| `unsupported-claim` | A qualification, title, award or responsibility the profile lacks | The probability reaches the threshold |

A refused question fails closed. Thresholds are tuned on train, per mode,
by balanced accuracy; a mode with only one label on train keeps 0.5.

To run it, with an OpenAI key in the shell. Answers are cached under
`<rounds>/judge/`, so a second run with the same version and model is free:

```sh
pnpm exec tsx packages/evaluations/src/cohort-judge-command.ts ~/draft-loop-ftx --max-usd 0.5
```

### Result: `cohort-judge-v1` on `gpt-6-luna`

Commit 6df979d0, train and dev only (29 rounds with a draft), $0.0074.
Thresholds tuned on train: 0.7 for `scope-stretch`, 0.5 for the rest.

| Mode | Train agreement | Train TPR / TNR | Dev agreement | Dev TPR / TNR |
| --- | --- | --- | --- | --- |
| `must-cover-omission` | 89% | 100% / 0% | 100% | 100% / - |
| `attribution-inflation` | 84% | - / 84% | 100% | - / 100% |
| `scope-stretch` | 95% | 0% / 100% | 100% | - / 100% |
| `unsupported-claim` | 79% | - / 79% | 100% | - / 100% |

- **Not yet usable as a gate.** Dev holds no failing round for three modes
  and no passing round for `must-cover-omission`, so its 100% says little.
- **False alarms on train.** About 3 rounds for `attribution-inflation` and
  4 for `unsupported-claim`, which no train round fails. The 2 train rounds
  that keep every must-cover fact were both judged as omitting one.
- **One miss.** The only `scope-stretch` fail (an occasional duty stated as
  a standing one) passed at 0.7.
- **Next.** Measuring these modes needs drafts that fail them: see
  planted failures below.

### Planted failures

`fixtures/failure-taxonomy/seeds.json` (#3291) holds draft-style sentences
for the nine train and dev cases. Each real draft yields copies, labelled by
construction, and only the planted mode is scored on a copy:

- one copy per mode the real draft passes, with one sentence that fails it:
  inflated credit, a booked course stated as held, or an invented title;
- one copy that appends a sentence for every must-cover fact.

Add `--seeded` to the judge command to send them. The run on commit
6a2df8b9 sent 115 copies for $0.0299. Thresholds tuned on train, real and
planted together: 0.1 for `must-cover-omission`, 0.9 for
`attribution-inflation`, 0.7 for `scope-stretch` and 0.8 for
`unsupported-claim`.

| Mode | Train planted (75) | Dev planted (40) | Real train (19) | Real dev (10) |
| --- | --- | --- | --- | --- |
| `must-cover-omission` | TNR 68% | TNR 70% | TPR 100%, TNR 0% | TPR 100% |
| `attribution-inflation` | TPR 95% | TPR 70% | TNR 95% | TNR 100% |
| `scope-stretch` | TPR 78% | TPR 100% | TPR 0%, TNR 100% | TNR 100% |
| `unsupported-claim` | TPR 100% | TPR 100% | TNR 84% | TNR 100% |

- **Planted claims are caught.** Invented titles and stretched credentials
  are found on dev every time; inflated credit 7 times in 10.
- **Modes blur.** Almost any planted sentence also scores high on
  `unsupported-claim`, and a planted EICR qualification scores as
  unsupported rather than stretched. Read the four statements as one
  "claim the source does not support" signal, not four.
- **Real false alarms have one cause.** A label audit of the six real rounds
  with high scores found no inflated or unsupported claim in any. Each one
  places a role's work under the wrong employer, which the codebook files as
  `chronology-drift` or `role-omission`.
- **Must-cover is not usable yet.** Appending every fact does not make a
  draft pass: the chronology and attribution facts still score low when the
  rest of the draft contradicts them. A per-fact question cannot tell
  "missing" from "stated and contradicted".

The judge is not yet a gate. A `cohort-judge-v2` would tell the model that
misplaced work is a chronology problem, merge the claim statements, and ask
must-cover as "stated anywhere" separately from "contradicted". Held-out is
still unsent.

## Live evaluation

`pnpm eval:live` (#3289) runs fresh Economy rounds over cohort cases and
scores every draft with the deterministic scorer and the model judge. It
prints each mode's fail rate and exits 1 when a rate rose by more than one
round's worth against the last result recorded for the same models, prompt
versions and judge. It is manual and paid, and never runs in hosted CI.

| Step | Command |
| --- | --- |
| Free dry run | `pnpm eval:live --out ~/draft-loop-eval/dry --fixture` |
| Paid run, recorded | `pnpm eval:live --out ~/draft-loop-eval/<label> --label <label> --total-cap-usd 1 --record` |
| Before run on earlier prompts | Prefix the paid run with `DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION=cli-author-v20 DRAFT_LOOP_EVAL_CRITIC_PROMPT_VERSION=cli-critic-v11` |

- **Needs:** `ANTHROPIC_API_KEY` for the writer, `OPENAI_API_KEY` for the
  critic and the judge, and a fresh `--out` outside the repository per run.
- **Tracks:** every mode except `must-cover-omission`, which waits for the
  v2 judge (#3293). Judge thresholds are the ones tuned on planted failures.
- **Records:** `packages/evaluations/fixtures/eval-live/results.json` holds
  only counts, rates, models, prompt versions, commit and cost. Run
  `pnpm format` before committing it.
- **Pins:** only the current and the previous prompt version of each role
  can be pinned; any other value stops the run.
- **Gate:** a new prompt version or default model needs its result in the
  prompt score manifest; see [Prompt score gate](prompt-score-gate.md).

### Result: the non-tech prompt changes

Author `cli-author-v20` and critic `cli-critic-v11` against `cli-author-v21`
and `cli-critic-v12` (#3087 to #3091), on the four non-tech cases, two
rounds each, at commit 0e0a18fb. Both runs together cost $0.76.

| Mode | v20 / v11 | v21 / v12 |
| --- | --- | --- |
| `placeholder-left` | 100% | 100% |
| `chronology-drift` | 50% | 50% |
| `role-omission` | 25% | 25% |
| `unsupported-claim` | 0% | 13% |
| Other tracked modes | 0% | 0% |

- **No measurable change.** The prompt changes targeted wording, such as
  role-neutral evidence and acronyms, which these modes do not score.
- **One judge false alarm.** The single `unsupported-claim` fail
  (case-sales-r2) holds no unsupported claim when read by hand.
- **Placeholders every time.** Every draft leaves `[Your name]` and
  `[Phone]` in its contact line, though each profile states the name.
