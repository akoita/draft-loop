# Failure taxonomy

This page is for whoever runs or extends the labelled rounds behind the eval
suite (#1105, then #1107). It says how rounds are produced, how they are
labelled, and how the split works.

**Status:** protocol only. The labelled set and its results are added when the
paid rounds have run.

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
  --preset economy --per-run-cap-usd 0.07 --total-cap-usd 3
```

- To sign in with the signed-in `claude` or `codex` CLI instead of an API key, export
  `DRAFT_LOOP_ANTHROPIC_AUTH_MODE=user-session` or `DRAFT_LOOP_OPENAI_AUTH_MODE=user-session`.
- `--out` must be outside the repository. Each round gets `round.json` with
  the run state, cost, draft and critic findings.
- The script stops before a round that could pass the total cap, and skips
  rounds that already have `round.json`, so it can resume.
- Software cases run three times, non-tech cases four times: 40 rounds.

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
