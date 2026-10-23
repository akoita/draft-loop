# Hosted parity

**Status:** First result 2026-10-23: quality matches, cost fails ([#1574](https://github.com/akoita/draft-loop/issues/1574))<br>
**Issue:** [#1554](https://github.com/akoita/draft-loop/issues/1554), part of
[#1358](https://github.com/akoita/draft-loop/issues/1358); the run itself is
[#1555](https://github.com/akoita/draft-loop/issues/1555)

Phase 1 of the client-server version ([ADR 0011](../adr/0011-client-server-version.md))
ends when a run on the hosted service matches the local-first result for the
same application. This page fixes what "matches" means before the first hosted
run, so a result cannot shape its own rule.

Like [manual parity](manual-parity.md), this page carries scores and
content-free observations only: no candidate, employer, project name or
private URL.

## Setup

Both sides run the same application:

- **Same reference.** One private reference from manual parity: its job post
  and full career source. Real reference material goes on the hosted service
  only with the owner's recorded consent; otherwise the run waits.
- **Same commit.** The hosted images and the local build come from the same
  commit of `main`.
- **Same pair.** The standard pair (Claude Opus 5.5 author, GPT-6.1 Sol critic)
  with the same profile versions and round limit. The hosted run passes them
  as `modelProfiles` when it begins; without them it runs on provider defaults
  and falls back to retrieval.
- **Same input.** Full-source mode with the whole career source, the same
  sensitivity rules and the same writing policy text.

The hosted run reaches Claude on Vertex AI in the EU and OpenAI's EU endpoint;
the local run uses the direct APIs. The route is the one difference the
comparison allows.

Until the staging billing account can use Claude on Vertex AI, its Claude
calls take the direct Claude API fallback with the owner's agreement
([#1555](https://github.com/akoita/draft-loop/issues/1555)); run history
records each one. Moving back to Vertex AI is
[#1564](https://github.com/akoita/draft-loop/issues/1564).

Staging's critic likewise calls OpenAI's global endpoint, with the owner's
agreement, until OpenAI enables EU data residency for the owner's
organization; the worker logs that route at every start. Both choices are
staging-only and process the owner's own material outside the EU.

## Pass

The hosted draft is scored as in manual parity, against the local draft of the
same day rather than against the reference CV. It passes when all five hold:

| Measure                   | Pass                                                         |
| ------------------------- | ------------------------------------------------------------ |
| Key-accomplishment recall | Within 2 accomplishments of the local draft, or above it     |
| Requirement coverage      | Within 1 requirement of the local draft, or above it         |
| Leaks                     | None                                                         |
| Format fit                | The same as the local draft                                  |
| Cost                      | The hosted run's estimated cost is US$3 or less              |

The cost is the run's estimate as the usage API reports it, with prompt caching
on Claude calls ([runtime and trust](../architecture/runtime-and-trust.md)).
The price levels stay conditional on it ([#1357](https://github.com/akoita/draft-loop/issues/1357)).

A leak is checked twice. The scorer reads the draft for never-share material,
and the never-share flow test (`apps/worker/src/never-share-flow.test.ts`)
shows on every change that such a section reaches no provider request.

## Recording a result

Each result records the date, the reference letter, the commit, the pair with
its profile versions, both drafts' scores, the hosted cost with its cache-read
share, and the scorer. The accomplishment list is the one frozen for the
reference in manual parity.

## Results

| Date       | Ref | Side                      | Recall  | Requirements | Leaks | Format fit                         | Cost            |
| ---------- | --- | ------------------------- | ------- | ------------ | ----- | ---------------------------------- | --------------- |
| 2026-10-23 | E   | Local, round 3 (approved) | 18 / 22 | 14 / 17      | 0     | Ten sections; 1,741 words          | Partly unpriced |
| 2026-10-23 | E   | Hosted, round 1           | 18 / 22 | 13 / 17      | 0     | The same ten sections; 1,573 words | US$3.52         |

Both runs used the standard pair (`standard-anthropic-author@1`,
`standard-openai-critic@2`) in full-source mode. The scorer was Claude Opus
5.5 with the same method and frozen lists for both drafts.

**Verdict: quality matches, cost fails.** Recall, coverage, leaks and format
pass. One hosted round cost US$3.52 against the US$3 limit: Claude took $2.75
over 3 calls (394K input tokens) and the critic $0.77 over 2 calls (305K). The
application plan calls send the whole source without the prompt cache, and the
usage API does not report the cache-read share yet. Fixing that is
[#1574](https://github.com/akoita/draft-loop/issues/1574); a hosted rerun after
it closes [#1555](https://github.com/akoita/draft-loop/issues/1555).

Deviations from the setup:

- **Commits.** Local ran at `b07b052` and hosted at `d8cd0c8`. The difference
  (#1569, #1571, #1573) touches only hosted routes, critic pricing and the
  hosted API, not drafting.
- **Rounds.** Hosted stopped after round 1 at staging's cost limit; local ran
  3 rounds. Hosted round 1 already equals local round 3 on recall and is
  within 1 on coverage. Local round 1 scored 16 / 22 and 14 / 17.
- **Routes.** Hosted Claude calls took the direct Claude API fallback and the
  critic took OpenAI's global endpoint, as described under Setup.
- **Local cost.** The local build priced neither the critic calls nor two
  revision calls, so its US$2.73 is a floor; at uncached list rates the whole
  run is at most about US$8.8.
- **Scoring.** Two or three coverage calls per draft were borderline, judged
  the same way on both sides. No never-share rules exist for reference E, so
  the leak check rests on the scorer's reading and the flow test.
- **Format.** The drafts were compared; only the local draft was exported.
