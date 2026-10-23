# Hosted parity

**Status:** Rules fixed 2026-10-23, before any hosted run; no result yet<br>
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
  with the same profile versions and round limit.
- **Same input.** Full-source mode with the whole career source, the same
  sensitivity rules and the same writing policy text.

The hosted run reaches Claude on Vertex AI in the EU and OpenAI's EU endpoint;
the local run uses the direct APIs. The route is the one difference the
comparison allows.

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

None yet.
