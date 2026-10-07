# CLI and desktop operations reference

This reference documents the source-only CLI command groups and the equivalent
desktop operations. Start from the [developer quick start](../../README.md#developer-quick-start)
for installation and the fixture demo; run any command below from the
repository root with Node.js 24.5.0 and pnpm 10.18.3.

Live use requires an explicit provider-transmission approval in the workspace,
configured provider credentials, and may incur provider cost. Keep real
candidate material out of the repository.

## CLI model profiles

Use `model-profiles` to print the registered profile catalog and pair presets
as JSON. The output includes exact versions, roles, bounded API pricing scope,
and separate quality and availability statuses. Catalog quality is unvalidated
and account or provider availability has not been checked. Listing is
content-free and does not call a provider.

The local release preflight checks each registry-derived provider/model
destination with one synthetic request before its end-to-end gate. Inspect that
request and plan with `pnpm test:model-suggestions:live --plan`; it does not
create provider adapters or resolve credentials. The default command performs
the live check, which can use paid API or subscription routes, and is reserved
for an explicitly approved local availability check or release preflight. Its result covers
availability under that bounded check only, not account guarantees, profile
controls, or CV quality.

The paid validation cohort remains limited to the required Economy and Standard
Anthropic/OpenAI destinations and supported optional Anthropic/OpenAI entries.
The exact opt-in DeepInfra GLM and Google Gemini development author profiles are
omitted from this cohort; listing a development preset does not add a provider
to release checks.

```sh
pnpm --filter @draft-loop/cli start model-profiles
pnpm --filter @draft-loop/cli start start ./workspace --model-preset economy
pnpm --filter @draft-loop/cli start start ./workspace --model-preset standard
pnpm --filter @draft-loop/cli start start ./workspace --model-preset development-glm
pnpm --filter @draft-loop/cli start start ./workspace --model-preset development-gemini
pnpm --filter @draft-loop/cli start start ./workspace \
  --author-profile standard-anthropic-author@1 \
  --critic-profile standard-openai-critic@2
```

`start` accepts either one pair preset or both exact `--author-profile` and
`--critic-profile` references. Each reference uses `profile-id@version` and
must support its selected role. Economy and standard are unvalidated opt-in
pairs. The separate `development-glm` opt-in pair uses the Z.ai
`zai-org/GLM-5.3-Flash` author through DeepInfra and the GPT-6 Luna critic; it
requires `DEEPINFRA_API_KEY`. The separate `development-gemini` opt-in pair uses
the Gemini 3.8 Flash author and the GPT-6 Luna critic; it requires
`GEMINI_API_KEY`. The active catalog contains six unique exact
profile versions; older profile
versions remain available for historical references but are not current
choices. A pair passed to `start` is recorded on that run only. It does not
change workspace model settings, transmission approval, or credentials. Resume
uses the pair already recorded in run history.

### Applied profile pair

A workspace can keep an applied pair so that new runs do not start without
profiles after a restart. The pair is stored as exact ids and versions in
`.draft-loop/model-profile-selection.json`, with the time it was applied.

```sh
pnpm --filter @draft-loop/cli start model-profiles apply ./workspace --model-preset development-gemini
pnpm --filter @draft-loop/cli start model-profiles apply ./workspace \
  --author-profile standard-anthropic-author@1 \
  --critic-profile standard-openai-critic@2
pnpm --filter @draft-loop/cli start model-profiles applied ./workspace
pnpm --filter @draft-loop/cli start model-profiles clear ./workspace
```

- `apply` takes one preset or both exact references, and refuses a pair that is
  not registered for its roles or whose company and model differ from the
  workspace's configured author and critic.
- `start` without profile options uses the applied pair when it still matches
  the workspace models. Profiles passed to `start` always win.
- A saved pair that no longer matches is ignored, and the run preflight says
  why. With no applied pair the preflight says that no profiles are attached
  and the run uses the legacy path: provider-default runtime controls and
  unknown context windows.
- A corrupt selection file stops `start` before any provider work. Fix it with
  `apply` or `clear`.
- Resume never reads the applied pair; it reuses the profiles recorded in the
  run.

The desktop app uses the same saved pair; saving and displaying it in the
desktop UI arrives with issue #910.

The opt-in Gemini 3.8 Flash development author is also selectable with
`--author-profile dev-google-gemini-author@2` and an exact critic profile, or
with `--author-company google --author-model gemini-3.8-flash`. Profile `@1`
(Gemini 3.7 Flash) stays registered and accepted so existing runs resume, but it
is no longer a preset or catalog entry. The 3.8 author requires
`GEMINI_API_KEY` from a paid-tier Gemini API project: free-tier terms let Google
use submitted content. The desktop offers the same `development-gemini` preset
in its model picker and stores the key in its own settings row; see
[Provider credentials](#provider-credentials). Desktop readiness for a Gemini
author requires the Google key, and Gemini model discovery is manual: enter the
exact model ID `gemini-3.8-flash`.

Profile selection requires a supported configured authentication route. Current
OpenAI Codex user-session and local routes reject profile selections; the CLI
does not switch authentication modes automatically. Account and provider
availability remains unchecked.

Each application OpenAI API-key adapter invocation makes one provider request
by default. Callers can explicitly configure retries; Anthropic, local, and
user-session adapters keep their existing retry behavior. This does not change
orchestration recovery.

If a Codex ChatGPT session explicitly rejects a selected model, the desktop
shows that diagnosis and suggests choosing a supported model or explicitly
switching OpenAI authentication to an API key. It never switches automatically.

## Provider credentials

Desktop provider settings can save or remove a dedicated DeepInfra API key for
Z.ai models served by DeepInfra. It uses the same local credential store as the Anthropic
and OpenAI keys, and saved app keys take precedence over environment variables.
The host reads `DEEPINFRA_API_KEY` when no app key is saved. DeepInfra remains API-key-only:
provider-managed session preferences are still limited to Anthropic and OpenAI.

A separate Google Gemini API key row works the same way for the development
Gemini author. The host reads `GEMINI_API_KEY` when no app key is saved. The row
states that the key sends submitted content to Google and that Gemini API
free-tier terms let Google use it, so candidate material needs a paid-tier key.
Google keys are API-key-only and are never shared with another provider.

The renderer receives only whether a key is configured and its storage source
and protection, never the stored key.

The DeepInfra GLM adapter reads structured output as a stream. It allows 120
seconds for the initial response, resets a 120-second idle limit as chunks
arrive, and stops after 10 minutes total. Adapter timeout diagnostics identify the
initial response, idle stream, or total deadline without including provider
content. Documented single-choice chunks may omit model, creation-time, and
choice-index metadata; supplied model identifiers are still checked against the
configured GLM model. Supplied creation timestamps must be finite, nonnegative
numbers within the safe-integer magnitude; fractional or changing timestamps
are accepted and are not persisted or used as response identity. Null role or
tool placeholders are treated as absent; actual tool calls remain rejected.

The DeepInfra GLM and Google Gemini development routes retry temporary overload and
rate-limit responses up to twice with a short backoff (about 2.5 s, then 5 s) before the
request fails. Quota, billing, authentication, and invalid-request failures are never retried.

## Desktop diagnostics

Packaged builds keep host-error diagnostics in `diagnostics/host-errors.jsonl`
under Electron’s local `userData` directory. This is the same application data
location used for credential and authentication preferences. Electron places it
under the application’s folder in `%APPDATA%` on Windows, `$XDG_CONFIG_HOME`
(or `~/.config`) on Linux, and `~/Library/Application Support` on macOS.

Each line contains only an ISO timestamp, capability, recognized error class,
and recognized bridge or provider code. Recognized classes include the
application's user errors (`JobRequirementUserError`,
`SourceIngestionUserError`, `CliUserError`), so a refused run start is
distinguishable from an unexpected failure. Messages, stacks, filesystem paths,
filenames, source content, and provider responses are excluded. The current log
and one rotated backup are each bounded to 64 KiB. Logging failures do not
interrupt a review operation. Logs stay local and are not uploaded automatically.

When a desktop action fails, the banner shows the application's own message
only when it is fixed, path-free and user-fixable, such as a job description
whose requirements are too long or an unreadable source file. Any other failure
names the action that failed, for example "Starting the review failed with an
unexpected error.", and never its private error text.

The desktop setup applies the same job-description check before a run when no
reviewed opportunity brief is selected. A job description with a requirement
that is too long to match keeps **Start author–critic review** disabled and
lists that message among its reasons, so the problem appears before you click.

## Desktop workspace navigation

Use **Close workspace** to return to the create/open screen. Saved workspace
files, run history, and profile versions remain on this device; unsaved setup or
profile form edits are discarded. Closing does not rewrite persisted run state.

The start page lists the ten most recently opened local workspaces. Select an
entry to reopen it, or clear the recent list; clearing history leaves workspace
files untouched. The native **Open workspace** picker remains available.

Creating a workspace asks only for its name and maximum review rounds. After a
real workspace is created, choose **Presets** or **Custom** in the model editor.
Opening an existing workspace keeps its current model pair; canceling the editor
does not change that pair. Apply a preset or save custom settings to replace the
pair used for future runs.

Stop a running review with its existing **Stop review** control before closing.
The desktop keeps the workspace open while a review action, knowledge update, or
candidate-profile operation is pending and says when to wait for it to finish.

Packaged desktop startup uses the native workspace setup. If the preload bridge
is unavailable, the desktop shows a connection error instead of loading the
browser fixture or creating a demo workspace. Choose **Try demo workspace**
explicitly when you want the fixture.

## Autopilot

By default a review pauses for you whenever the critic reports a blocking
finding, so you decide each finding before the next revision. Autopilot is an
off-by-default workspace setting that runs the author/critic/revise loop through
to the workspace's maximum rounds instead. The author revises from every critic
finding, blocking or warning, on its own.

An autopilot review still pauses early when:

- the draft is ready;
- a claim is disputed;
- a blocking factuality finding says the draft contradicts your materials, such
  as a date or metric that disagrees with the source;
- a provider or validation error stops a step, as without autopilot.

The last round always ends in review, and approval and export stay with you.
Turn it on in the desktop with the **Autopilot** checkbox on the start screen
or in **Run progress**. In the CLI, pass `--autopilot` to `init`, or switch an
existing workspace:

```sh
pnpm --filter @draft-loop/cli start autopilot on ./workspace
pnpm --filter @draft-loop/cli start autopilot off ./workspace
```

The setting applies from the next run action, including **Request revision** on
a run already awaiting approval.

## Opportunity briefs

The `opportunity` command group creates and reloads one durable brief, lists
its immutable versions, and creates edited or reviewed successors. Creation
reads a JSON manifest containing an `id` and ordered `sources`; local-file
paths exist only in that runtime input. Add `--allow-provider-data` only when
the source text may be sent to the configured author model for structured
extraction.

```sh
pnpm --filter @draft-loop/cli start opportunity create ./workspace \
  --input ./opportunity.json --allow-provider-data
pnpm --filter @draft-loop/cli start opportunity get ./workspace \
  --brief-id target-role
pnpm --filter @draft-loop/cli start opportunity edit ./workspace \
  --brief-id target-role --expected-version 1 --patch ./opportunity-patch.json
pnpm --filter @draft-loop/cli start opportunity review ./workspace \
  --brief-id target-role --expected-version 2
pnpm --filter @draft-loop/cli start start ./workspace \
  --opportunity-brief-id target-role --opportunity-version 3 \
  --candidate-profile-id default-profile --candidate-profile-version 3 \
  --allow-provider-data
```

`start` accepts each brief or candidate-profile ID and version only as a pair.
Each selected version must already be reviewed. DraftLoop verifies and pins
the exact immutable versions and their checksums in run context; later edits do
not change a started or resumed run. Starts that predate canonical profiles
remain supported without a profile selection.

Without a reviewed opportunity brief, a local job document supplies complete
list items and paragraphs with neutral priority. Markdown headings are excluded,
wrapped lines are joined, and later units are retained. These are syntactic
source units, not reviewed job criteria: use an opportunity brief to select
requirements and priorities before interpreting relevance as job fit. Local
input limits are 64 KiB, 100 units, and 2,000 characters per unit; overflow,
code fences, and tables require a reviewed brief instead of silent truncation.
A unit longer than 40 meaningful tokens is also refused at start, before any
provider call, because no CV block could cover half of it. This happens when a
web page is pasted with its navigation and biographies: list each requirement
as its own bullet line, remove boilerplate, or use a reviewed brief. The CLI
and desktop show the message.

Deterministic relevance uses lexical overlap within individual CV blocks: at
least half of a requirement’s meaningful tokens must appear in one block.
Words scattered across unrelated blocks cannot jointly satisfy a requirement.
Three narrow rules refine that match. Explicit degree entries answer standalone
computer-science/quantitative degree requirements while coursework and negated
or unfinished credentials are rejected; the degree clause is read on its own, so
`MSc in Computer Science; training in secure development.` still answers the
requirement. A requirement listing permitted
alternatives, such as `Prometheus or OpenTelemetry`, is satisfied by a block
naming one of them, with any surrounding condition still required. A stated
maturity qualifier, such as `early-stage`, must appear in the matching block
and is never inferred from headcount, funding, or the word `startup`. See the
[coverage contract](../architecture/drafting-and-review.md#degree-coverage). Other equivalent
phrasing can still be missed, including inflected forms such as `implemented`
for `implement`, and these signals do not establish semantic coverage or verify
a credential.

## Candidate profiles

The `profile` command group derives a canonical candidate profile from the
workspace's configured CKB selection, reloads exact or latest versions, and
creates immutable edited or reviewed successors. Derivation is the only
provider-backed operation and requires `--allow-provider-data`; the other
commands operate on workspace-local history. Profile commands never accept a
CKB store root. A draft can become reviewed, and a reviewed version can enter a
new run, only while its exact CKB selection still matches the workspace's
current lifecycle-ready selection. Historical profile versions and existing
run/export records remain available for audit after lifecycle changes.

Application consumers can omit `profileId` when listing profile versions to
load every complete history in the workspace, ordered by profile name and
version. The catalog is bounded to 256 profile names and fails closed when
larger; supplying a name keeps the existing exact-history behavior.

The desktop's optional **Existing reviewed profiles** picker loads the exact
reviewed version locally; it does not derive or transmit candidate material.
Source compatibility is checked again before starting a review. Older hosts
without the catalog capability retain the profile-name and history controls.

When a workspace opens, the desktop lists its saved profiles, drafts included,
in a **Saved profiles** picker (newest first, showing version and status) and
loads the most recent one locally if no profile name is entered. Dismissing the
native folder dialog for **Open knowledge store** is not an error and shows no
message.

Before approval, the desktop can show blockers from the readiness decision
persisted for the exact artifact. A rubric blocker includes its recorded score
and required threshold. The score is a check result, not a confirmed candidate
gap; token matching can miss equivalent phrasing. Accepting a finding does not
change coverage or bypass the gate. Review requirements and coverage evidence;
readiness can remain blocked after a revision or new run.

Once blocking findings are resolved, you can still approve a draft whose final
checks fail. Enter a reason and choose **Approve with override**, or run
`draft-loop approve --override-final-checks "<reason>"`. The reason and the
blocker codes it covers are bound to that exact artifact and recorded in the run
history, and export accepts only that recorded override. This keeps a review
finishable at the round limit, when **Request revision** is unavailable.

Facts with the same category, subject, field, and value found in several places
(for example the same skill in different sections of one source) are merged into
one fact that keeps all their sources. A possible-duplicate warning remains only
when such facts cannot be merged because the combined sources would exceed the
per-fact limit; different values of the same field still raise a conflict.

If extraction fails, it saves no facts and returns one omission issue with
opaque source references. Recognized provider failures provide fixed action
guidance; unrecognized errors and provider diagnostics are never shown. Input
preparation, response format, and grounding failures have distinct messages.

DeepInfra malformed-stream guidance may include up to two fixed protocol reason
counts and a bounded remainder; it never includes chunk data, model identifiers,
source content, or paths.

DeepInfra timeout guidance distinguishes the initial response, an idle stream,
and the total deadline; missing or conflicting phase diagnostics use generic
timeout guidance. Idle and total timeout guidance may also state how many answer
and reasoning characters the stream returned before stopping; the counts never
include the text itself. Transient errors name only HTTP 500, 502, 503, or 504; other
statuses use generic provider guidance. Older saved generic failures cannot be
reconstructed because their timeout phase and status were not retained.

An otherwise valid source-backed omission can retain its visible review warning
when it names a fact the model did not return; only those dangling omission
references are removed, followed by strict validation and evidence grounding.
Dangling conflict or duplicate references and omissions without source
references still fail without saving facts.
Repeated model fact keys are repaired only when no issue refers to that key;
later facts receive collision-free local identities, with all evidence still
grounded. Issues that reference an ambiguous duplicate key remain failures.

An explicit Anthropic credit-balance or enforced spending-limit response shows
billing guidance; the app does not estimate charges from failed attempts.

The desktop distinguishes a saved extraction failure, an empty profile, a draft
that still needs human review, open issue blockers, and a reviewed version. An
empty failed version shows one callout with up to three deduplicated, sanitized
issue reasons; the version details only note that the failure is recorded rather
than repeating the cause. The action is labeled **Retry profile generation**;
the existing provider-data approval must be granted again before selected
material is sent, and a hint says so while the approval box is unticked.

While a profile is generating, the desktop shows a spinner, an elapsed timer,
and, once the plan is known, which part is running (for example **Part 2 of 4**,
then **Finishing…**); it does not estimate completion time. The button reads
**Generating…**. Large knowledge bases are processed in parts and can take
several minutes, so keep DraftLoop open. **Cancel generation** stops further
provider calls and saves nothing.

Before retrying, follow the recorded cause and recovery guidance. Renaming the
profile does not fix the underlying failure. Retrying sends selected material
again and may consume provider credits.

A grounding failure on a smaller input may trigger one additional full-context
request with the same approved sources and fixed diagnostic counts. It returns a
full replacement proposal, which must pass schema and grounding checks before any
facts are saved. Large inputs use per-call recovery instead (see the proactive
plan below). Failed values and quotes are not sent as feedback. This bounded
recovery has no live-provider reliability claim.

If the replacement still fails grounding, DraftLoop keeps the grounded facts and
drops only the ungrounded ones, including any proposed issue that cites a
dropped fact or an unknown source. It adds one open warning, with no quoted
content, that states how many facts were dropped; acknowledge it after checking
the profile for missing facts. An ungrounded fact is never saved. If nothing
grounded remains, no facts are saved and the profile shows as empty rather than
as a failed extraction.

Empty profiles and drafts with open issues cannot be marked reviewed; warnings
also block until acknowledged or resolved and saved. In the desktop app, a
severity group with several issues offers one control that sets the status of
every error or every warning at once. A reviewed profile is a
human-reviewed record, not a claim of application readiness or quality.

Anthropic structured output uses the SDK-normalized provider schema, while
application schema and source-grounding checks remain authoritative. Requests
require exact contiguous evidence quotes, unique fact and issue references,
and grounded facts for both sides of any conflict.

Extraction guidance gives each subject key one specific real-world entity and
distinguishes attributes, events, and contexts before proposing conflicts. For
example, separate credentials remain separate when they share an issuer, and a
launch date differs from a publication date. The prompt still requires genuine
disputed claims to remain conflicts without choosing an authoritative answer.

The extractor may remove one outer Markdown emphasis pair from a quote only
when the remaining exact source text contains the entire unchanged fact value.
Other quote mismatches remain fail-closed; fact values and source text are not
rewritten.

Coverage instructions direct the extractor to scan every supplied source
rather than return only highlights; they do not guarantee that every supported
fact will be found. The 32,768-token ceiling applies to API-key requests for
Claude Sonnet 5.5 and Opus 5.5 and the configured DeepInfra GLM author route.
Canonical profile extraction uses a detached GLM profile at the same ceiling
and requests `reasoning_effort: "none"` to disable reasoning, following
[DeepInfra's reasoning control](https://docs.deepinfra.com/chat/reasoning). The
normal GLM author profile keeps `low` reasoning. The Gemini author route uses the same ceiling, with a
detached extraction profile that sets `thinkingBudget: 0`. These settings make no speed
or quality guarantee; user-session, local, and other model routes keep 8,192
tokens.

For more than 65,536 UTF-16 text units across one to four unique prepared
sources, extraction proactively makes one call per source up to 8,192 UTF-16
units and divides each larger source into contiguous windows of at most 8,192
units. The plan uses at most 96 calls and is declined if it would exceed that
cap.

One source may be up to 524,288 characters, the same bound as the whole
selection, and is extracted in these bounded windows without manual splitting.
No provider request ever carries more than 131,072 characters of one source.
When a source above that size cannot be windowed, for example because more than
four sources are selected, it is left out of extraction and the profile records
a source-too-large issue naming it; sources above 524,288 characters are
likewise reported and skipped.

Each planned call sends only its own source, or only its window text with the
source ID, media type, and the window's UTF-16 offsets and source length. Other
sources and windows are never included. Each result is grounded as it arrives. A
call that fails grounding gets at most one replacement for that same call with
fixed diagnostic counts, so a plan makes at most 192 calls. After a second
failure, only that call's ungrounded facts are dropped and counted toward the
single warning above; planned extractions never make the full-corpus replacement.

Cross-source conflicts and duplicates for planned extractions come from local
detection over the aggregated facts, which depends on consistent subject naming
across calls.

For smaller inputs, an explicit output-token truncation
can trigger one focused call per source for two to four sources; if a focused
call also truncates, that source can be retried in four contiguous text windows.
This fallback uses at most 21 application calls including the original request.
Those focused calls keep the full selected source set as context.

Every request keeps the same per-call token cap. These bounds make no latency or
coverage guarantee. Results are aggregated after every call succeeds, then pass
the existing schema and source-grounding checks before any facts are saved.

One profile holds at most 2,048 facts and 1,024 review issues. When the
aggregated calls exceed either bound, nothing is saved and the guidance names
the bound and asks for fewer or smaller sources.

Proposal validation removes redundant entries only when failures consist solely
of repeated evidence tuples or issue fact/source references, then reruns the full
schema. Other schema failures reject the full proposal, so no facts are saved.
Guidance may show bounded reason counts, such as fact values or evidence
quotes over the 2,000-character limit, but omits values, source text, and
paths.

Skills are treated as collection values, so distinct skill facts do not become
automatic conflicts even when they share a subject. Equal values can still
raise duplicate warnings. Unscoped certifications are also collections, while
scoped certifications retain automatic conflict detection. Explicitly proposed
conflicts remain visible for skills and certifications.

Exact duplicate source contents are sent once per bounded group while every
original source version remains attached to facts as local provenance.

```sh
pnpm --filter @draft-loop/cli start profile derive ./workspace \
  --profile-id default-profile --allow-provider-data
pnpm --filter @draft-loop/cli start profile get ./workspace \
  --profile-id default-profile
pnpm --filter @draft-loop/cli start profile edit ./workspace \
  --profile-id default-profile --expected-version 1 --patch ./profile-patch.json
pnpm --filter @draft-loop/cli start profile review ./workspace \
  --profile-id default-profile --expected-version 2
```

The packaged desktop host exposes the same five profile operations through its
validated native capability boundary. Renderer commands use the active
workspace identity, never accept a CKB root or open a profile-specific picker,
and receive an explicit bounded projection of facts, issues, and opaque source
references. The collecting workspace includes a dedicated profile surface for
derivation approval, immutable version selection, fact-value and issue-status
editing, review, and exact reviewed-version selection for the next run.

When the native host advertises `workspace.configure-models`, **Change models**
opens one editor with **Presets** and **Custom** choices. Custom settings use
the same discovery and independence checks as before. Saving replaces the
author and critic pair for future runs without changing the workspace name,
round limit, or existing run records. A changed provider
transmission identity requires fresh acknowledgement before a later run starts
or resumes; saving settings never sends candidate material to a provider.

The native host can report which registered exact profiles the active
workspace's configured authentication routes support. This is local metadata
and makes no credential or provider calls. The editor's **Presets** view offers
presets and role-specific exact profile choices when both model-configuration
and route-support capabilities are available. Each preset is a card that names
the writing and reviewing models in plain language, shows the providers and
public per-million-token prices, and carries **Unvalidated**, **Development**,
and **Not available with your current sign-in** badges where they apply. A
**Custom pair** card reveals the exact author and critic profile selects, and
exact IDs and runtime controls sit in a collapsed **Details** disclosure.
Choices stay a draft until **Apply for future runs** saves their provider/model
destinations and the pair itself. Existing run records remain unchanged.
Unsupported or unavailable routes block profile-backed starts, and
provider-transmission acknowledgement is still required. OpenAI Codex
user-session routes do not support these profiles, and authentication is never
switched automatically.

The applied pair is the one the CLI saves in `.draft-loop/model-profile-selection.json`
(see [Applied profile pair](#applied-profile-pair)). The desktop reads it when a
workspace opens, so after reopening the workspace or restarting the app the
dialog shows **Applied next-run profiles** with the exact versions, and new
runs send that pair. If the pair cannot be saved, the dialog says so and does
not show it as applied, although the models themselves were already changed.
Saving custom models clears the pair. A saved pair that no longer matches the
workspace models is not used; the dialog says why.

The configured-models card names the applied preset, or warns "No model
profiles: provider defaults, unknown context windows." when the next run would
attach none.

For a selected draft pair, the picker also provides an editable API token-cost
scenario based on the catalog's dated public, uncached text API rates. Its
initial 10,000-input/1,000-output-token example plans two author calls and one
critic call; change the values to describe another scenario. The estimate is
not a forecast, hard cap, or bill and does not set runtime token budgets. It
excludes extra calls and retries, input growth, cache, tools, batch, regional
premiums, and unsupported long context. User-session routes show public rates
only and do not estimate subscription quota or charges. The reusable
application boundary is `@draft-loop/application/model-profile-budget`.

Cancel leaves the saved provider/model destinations and current next-run
selection unchanged.

When provider model discovery fails or returns no IDs, the setup and **Change
models** forms offer exact IDs from the active application profile catalog.
Labels show only each entry's configured tier and registered author or critic
role. These fields do not establish account, plan, or CV-quality suitability.
Suggested IDs are not guaranteed to work with your account, plan, or CLI version.
You can still enter any exact model ID, and successful live discovery remains
the displayed source. Each catalog entry shows its metadata review date;
CLI-specific live availability for these suggestions has not been reverified. Economy and
standard remain the curated pair presets, with a separate development GLM
preset and a separate development Gemini preset. The active catalog lists
Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Luna, GPT-6.1 Sol, GLM-5.3-Flash
through DeepInfra, and Gemini 3.8 Flash. GLM's standard uncached API rates are
$0.15 per million input tokens and $0.50 per million output tokens, reviewed
2026-10-02; Gemini's are $0.75 and $3.75, reviewed 2026-10-04. Quality is
unvalidated and account availability unchecked. Historical profile versions, including premium-tier entries, remain
resolvable but are not offered as current suggestions or presets. All catalog
quality entries are unvalidated and availability has not been checked; the
review date documents metadata review, not a live provider probe. Local
endpoints remain free-text because there are no local server profile IDs.

Catalog price metadata covers the standard, uncached text API at up to 200,000
input tokens. It excludes cache, tool, batch, regional, and subscription
pricing. Sources are the official [Anthropic model overview] and [Sonnet 5.5
overview], official OpenAI pages for [GPT-6.1 Sol] and [GPT-6 Luna], and the
DeepInfra [GLM-5.3-Flash API page] and [model announcement], and Google's
[Gemini API pricing] and [Gemini models] pages.

OpenAI adapter responses retain valid cached-input, cache-write, and reasoning
token details alongside input/output totals. A rate estimate accounts for
reported cache categories only when their rates are supplied; malformed or
missing usage, or a missing applicable rate, leaves cost unknown. Missing usage
keeps zero token totals for compatibility. These estimates are adapter results,
not persisted run totals or invoice amounts.

[Anthropic model overview]: https://platform.claude.com/docs/en/models/overview
[Sonnet 5.5 overview]: https://platform.claude.com/docs/en/models/sonnet-5-5/overview
[GPT-6.1 Sol]: https://developers.openai.com/api/docs/models/gpt-6.1-sol
[GPT-6 Luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
[GLM-5.3-Flash API page]: https://deepinfra.com/zai-org/GLM-5.3-Flash/api
[model announcement]: https://deepinfra.com/blog/glm-5-3-flash-deepinfra
[Gemini API pricing]: https://ai.google.dev/gemini-api/docs/pricing
[Gemini models]: https://ai.google.dev/gemini-api/docs/models

## Writing policies

New real workspaces start with a default policy that asks for a professional,
concise, two-page CV, plain punctuation without em dashes, exact facts with no
rounding up, every listed certification kept, employment kept distinct from
consulting, training and personal projects, and personal circumstances left out.
Replace it with `policy activate`. Existing workspaces and demo (fixture)
workspaces are not changed.

Writing policies are local, immutable versions. `policy activate` imports a
file and makes it the workspace default for future runs; `policy import` adds a
version without changing that default. Metadata-only reads are the default, and
exact local content is printed only when `--content` is supplied.

```sh
pnpm --filter @draft-loop/cli start policy activate ./writing-policy.md ./workspace
pnpm --filter @draft-loop/cli start policy import ./opportunity-policy.md ./workspace
pnpm --filter @draft-loop/cli start policy current ./workspace
pnpm --filter @draft-loop/cli start policy list ./workspace
pnpm --filter @draft-loop/cli start policy show <checksum> ./workspace --content
```

A policy may contain `Tone`, `Spelling locale`, `Verbosity`, `Page target`,
`Section order`, `Emphasis areas`, and `Anti-formulaic defaults` directives in
`Name: value` form, alongside forbidden-term and punctuation rules. The
anti-formulaic defaults are transparent and enabled unless the policy says
`Anti-formulaic defaults: disabled`.

In the desktop, **Edit policy** on the Writing policy setup card opens the
active policy as text, or the default policy when the workspace has none.
Tone, verbosity, page target and spelling locale selectors rewrite the matching
`Name: value` lines, and editing the text updates the selectors. Saving creates
a new version for future runs, as `policy activate` does; the application's
message appears inline when the text is rejected, and nothing is saved. Choosing
a policy file remains available.

An imported version can be selected as a complete override for one reviewed
opportunity. The active workspace policy is unchanged, and the run records both
base and override versions:

```sh
pnpm --filter @draft-loop/cli start start ./workspace \
  --opportunity-brief-id target-role --opportunity-version 3 \
  --writing-policy-override <checksum> --allow-provider-data
```

## Candidate knowledge bases

The CLI exposes shared CKB controls through `knowledge`: initialize a portable
store with its default CKB, open or list a store, inspect path-free lifecycle
readiness, list path-free source/version identities, report duplicate groups,
inspect the count-only managed-file inventory, and import an explicitly chosen
local file, bounded local directory, or explicitly approved HTTPS URL. A later
local file version can be appended to an existing file source without replacing
its remembered origin.
The CLI can also bind one or more ready CKBs to a workspace; combining CKBs
requires `--approve-combination`. For example:

```sh
pnpm --filter @draft-loop/cli start knowledge store init ./candidate-knowledge
pnpm --filter @draft-loop/cli start knowledge store list ./candidate-knowledge
pnpm --filter @draft-loop/cli start knowledge store inventory ./candidate-knowledge
pnpm --filter @draft-loop/cli start knowledge store backup \
  ./candidate-knowledge ./candidate-knowledge-backup --yes
pnpm --filter @draft-loop/cli start knowledge store inspect-backup \
  ./candidate-knowledge-backup
pnpm --filter @draft-loop/cli start knowledge store restore \
  ./candidate-knowledge-backup ./restored-candidate-knowledge \
  --collision fail-if-destination-exists --yes
pnpm --filter @draft-loop/cli start knowledge base create ./candidate-knowledge "Public projects"
pnpm --filter @draft-loop/cli start knowledge base archive \
  ./candidate-knowledge KNOWLEDGE_BASE_ID --confirm
pnpm --filter @draft-loop/cli start knowledge base delete-preview \
  ./candidate-knowledge KNOWLEDGE_BASE_ID
pnpm --filter @draft-loop/cli start knowledge base delete \
  ./candidate-knowledge KNOWLEDGE_BASE_ID \
  --confirmation-token TOKEN_FROM_PREVIEW --yes
pnpm --filter @draft-loop/cli start knowledge source import \
  ./candidate-knowledge KNOWLEDGE_BASE_ID ./career-history.md
pnpm --filter @draft-loop/cli start knowledge source import-directory \
  ./candidate-knowledge KNOWLEDGE_BASE_ID ./career-material
pnpm --filter @draft-loop/cli start knowledge source import-url \
  ./candidate-knowledge KNOWLEDGE_BASE_ID https://example.com/profile --approve
pnpm --filter @draft-loop/cli start knowledge source append-file-version \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID ./updated-career-history.md
pnpm --filter @draft-loop/cli start knowledge source origin-status \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID
pnpm --filter @draft-loop/cli start knowledge source refresh-file \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID
pnpm --filter @draft-loop/cli start knowledge source refresh-url \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID --approve
pnpm --filter @draft-loop/cli start knowledge source rebind-file \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID ./relocated-career-history.md
pnpm --filter @draft-loop/cli start knowledge source retirement-state \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID
pnpm --filter @draft-loop/cli start knowledge source retire \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID --confirm
pnpm --filter @draft-loop/cli start knowledge source directory-rebind-preview \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID ./relocated-career-material
pnpm --filter @draft-loop/cli start knowledge source directory-rebind-apply \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID ./relocated-career-material --confirm
pnpm --filter @draft-loop/cli start knowledge source directory-refresh-preview \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID
pnpm --filter @draft-loop/cli start knowledge source directory-refresh-apply \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID --confirm
pnpm --filter @draft-loop/cli start knowledge source directory-moved-candidates \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID
pnpm --filter @draft-loop/cli start knowledge source directory-member-move \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID SOURCE_ID --confirm
pnpm --filter @draft-loop/cli start knowledge source directory-reconciliation-preview \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID
pnpm --filter @draft-loop/cli start knowledge source directory-reconciliation-apply \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID \
  --approved-retirement-source-id SOURCE_ID --confirm
pnpm --filter @draft-loop/cli start knowledge source directory-add-members \
  ./candidate-knowledge KNOWLEDGE_BASE_ID DIRECTORY_ID --confirm
pnpm --filter @draft-loop/cli start knowledge source list \
  ./candidate-knowledge KNOWLEDGE_BASE_ID
pnpm --filter @draft-loop/cli start knowledge source duplicates \
  ./candidate-knowledge KNOWLEDGE_BASE_ID
pnpm --filter @draft-loop/cli start knowledge select ./workspace \
  ./candidate-knowledge KNOWLEDGE_BASE_ID
```

### Source sensitivity

A knowledge base can hold sensitivity rules that classify the sections of its
Markdown sources into three tiers: `normal`, `sensitive`, and `never-share`.
Rules are saved as immutable versions; every add or remove writes a new
version, and a knowledge base with no saved version has no rules.

> **Where rules apply.** Canonical profile derivation and review runs use the
> knowledge base's current rules. `never-share` sections are never sent to a
> provider. `sensitive` sections are withheld too, unless the workspace has
> explicitly allowed them (see [Sensitive-section consent](#sensitive-section-consent)).
> Markdown only: other sources are sent unchanged.
>
> - **Derivation** removes excluded sections before extraction and drops any
>   fact whose evidence quote is not found in allowed source text, which is
>   reported in the profile's dropped-fact warning. A source whose sections are
>   all excluded is skipped, with a warning issue on the profile. The command
>   result lists the rules version used per knowledge base; the profile file
>   does not store it.
> - **Runs** drop every retrieved chunk that overlaps an excluded section
>   (any overlap, so a chunk that straddles a boundary is dropped) before it
>   is selected, traced or sent, on every retrieval path. A second check
>   refuses any author or critic request that still contains a distinctive
>   line of an excluded section, without calling the provider and without
>   quoting the text. If the rules or source text cannot be read, the run
>   stops instead of sending unfiltered material. A run does not record the
>   rules version yet.

How rules classify a source:

- **Heading matching.** A rule matches a section's own heading or any
  ancestor's, either by text (`--heading-contains`, case-, accent- and
  emphasis-insensitive) or by an exact heading path from the top level down
  (`--heading-path`). Rules never use offsets, so they keep working when the
  source file is refreshed.
- **Strictest wins.** A section takes the strictest tier among the rules that
  match it: `never-share` over `sensitive` over `normal`.
- **Headings only.** Only ATX headings (`#` to `######`) start a section.
  Text that is not under its own heading cannot be tiered separately; add a
  heading to isolate it. Setext (underlined) headings and `#` lines inside
  code fences are not headings.
- **Markdown only.** Plain-text, HTML, PDF and DOCX sources are not split, so
  `preview` shows one root section that no rule can match.
- **Suggestions are never applied silently.** `suggestions` lists defaults
  such as compensation and contact headings; `adopt ... --confirm` adds the
  ones you name, skipping any that already exist.

```sh
pnpm --filter @draft-loop/cli start knowledge sensitivity list \
  ./candidate-knowledge KNOWLEDGE_BASE_ID
pnpm --filter @draft-loop/cli start knowledge sensitivity add \
  ./candidate-knowledge KNOWLEDGE_BASE_ID --tier never-share \
  --heading-contains "Salary expectations"
pnpm --filter @draft-loop/cli start knowledge sensitivity add \
  ./candidate-knowledge KNOWLEDGE_BASE_ID --tier sensitive \
  --heading-path "Experience" "Acme" --id acme-details
pnpm --filter @draft-loop/cli start knowledge sensitivity remove \
  ./candidate-knowledge KNOWLEDGE_BASE_ID acme-details
pnpm --filter @draft-loop/cli start knowledge sensitivity suggestions
pnpm --filter @draft-loop/cli start knowledge sensitivity adopt \
  ./candidate-knowledge KNOWLEDGE_BASE_ID suggest-compensation --confirm
pnpm --filter @draft-loop/cli start knowledge sensitivity preview \
  ./candidate-knowledge KNOWLEDGE_BASE_ID SOURCE_ID
```

`add` takes exactly one of `--heading-contains <text>` or
`--heading-path <heading...>`, with one argument per heading, and an optional
`--id`; an id is generated when omitted. A duplicate id or an equivalent rule
is rejected. `preview` prints each section's heading path, tier, matching rule
ids and character count for the latest version of the source (`--version` picks
another) and omits section text unless you pass `--text`. `list`, `add`,
`remove`, `suggestions`, `adopt` and `preview` accept `--json`.

#### Sensitive-section consent

A workspace can allow `sensitive` sections, for example contact details for a
CV header, to be sent to providers. The default is off. The setting is stored
per workspace in `.draft-loop/sensitive-knowledge-consent.json`, separate from
`workspace.json`.

- **Never-share is unaffected.** `never-share` sections are never sent,
  whether consent is on or off.
- **One setting for every send.** Profile derivation reads the consent once per
  derivation. A run reads it once on start and once on resume, and uses the same
  setting for retrieval and for the check that refuses outgoing requests.
- **Fails closed.** A missing file means consent is off. A corrupt or invalid
  file stops the derivation or run before any retrieval or provider request,
  with a message that tells you to reset it with `--deny`.
- **Counts only.** The read form prints section and character counts per
  selected knowledge base, now and under the opposite setting, but never
  headings or text.

```sh
pnpm --filter @draft-loop/cli start knowledge sensitivity consent ./workspace
pnpm --filter @draft-loop/cli start knowledge sensitivity consent ./workspace --allow
pnpm --filter @draft-loop/cli start knowledge sensitivity consent ./workspace --deny
```

Without a flag the command only prints the state. `--allow` and `--deny` are
mutually exclusive, and all forms accept `--json`. The output always states that
`never-share` sections are never sent and whether `sensitive` sections are sent.
The desktop preflight control for this setting arrives with
[#897](https://github.com/akoita/draft-loop/issues/897); until then, use the CLI.

### Evidence mode

A workspace chooses what candidate material a run's author and critic
receive. The setting is stored in `.draft-loop/evidence-mode.json` beside
`workspace.json` and is read each time a run starts or resumes.

- `retrieval` (the default) sends the composed top excerpts, at most twenty
  chunks.
- `full-source` sends every eligible chunk of the selected knowledge sources,
  in selection, source and chunk order, instead of the top excerpts. Chunks
  withheld by [source sensitivity](#source-sensitivity) are never included.
  Evidence IDs, citation rules and validation are the same as in retrieval
  mode.

The evidence must fit a size budget: half of the smaller known context window
of the author and critic profiles, at four characters per token, or 240,000
characters when either window is unknown. The serialized chunks, including
their identifiers, are counted against it. When they do not fit, or no chunk is
eligible, the run uses retrieval instead. A `full-source` run prints an
`Evidence mode:` line in its preflight with the chunk count and the budget, or
the reason for the fallback, and records the decision as a `run.evidence-mode`
audit event in the workspace history. A run in `retrieval` mode prints and
records nothing extra. A missing setting means `retrieval`; an unreadable one
stops the run before anything is sent.

```sh
pnpm --filter @draft-loop/cli start evidence mode ./workspace
pnpm --filter @draft-loop/cli start evidence mode ./workspace full-source
pnpm --filter @draft-loop/cli start evidence mode ./workspace retrieval --json
```

The workspace argument is required. Without a mode the command shows the
current one. It applies to workspaces with a candidate knowledge selection and
never starts a run. Both forms accept `--json`.

### Local embedding model

Semantic retrieval ([ADR 0009](../adr/0009-local-semantic-retrieval.md)) uses a
pinned local embedding model. It is optional and is never downloaded
implicitly. Three tiers are available:

- `311m` (default): Granite Embedding Multilingual R2, 768 dimensions, about
  313 MB.
- `97m`: Granite, 384 dimensions, about 98 MB, for low-resource machines.
- `eg2-text` (experimental): the text model of EmbeddingGemma 2, 768
  dimensions, about 175 MB. It scored higher on the
  [evaluation fixtures](../evaluation/semantic-retrieval-comparison.md#embeddinggemma-2)
  but embeds about three times slower than `311m`.

```sh
pnpm --filter @draft-loop/cli start embeddings status --tier 311m --verify
pnpm --filter @draft-loop/cli start embeddings install --tier 311m
pnpm --filter @draft-loop/cli start embeddings install --tier 311m --confirm
pnpm --filter @draft-loop/cli start embeddings install --tier 97m --from ./model-files --confirm
pnpm --filter @draft-loop/cli start embeddings remove --tier 97m
```

The commands behave as follows:

- **`status`** reports `absent`, `installing`, `ready`, `corrupt`, or
  `unsupported-platform`. `--verify` checks SHA-256 checksums as well as sizes.
  It makes no network calls.
- **`install` without `--confirm`** prints the approval details and downloads
  nothing: the Hugging Face source at the pinned revision, each file's size,
  the license, and the destination.
- **`install --confirm`** downloads the files into a staging directory, checks
  every size and checksum, and moves the directory into place in one rename. A
  failed or cancelled install leaves nothing behind. `--from <dir>` imports the
  same files from a local directory instead, with the same checks.
- **`remove`** deletes only that tier's files.

Models are stored in the per-user data directory, outside every knowledge base,
workspace, and backup. Set `DRAFT_LOOP_EMBEDDING_MODEL_ROOT`, or pass
`--model-dir`, to use another location. The runtime supports Linux x64 and
arm64, Windows x64 and arm64, and macOS on Apple silicon.

### Retrieval mode

A workspace chooses how its candidate knowledge is searched. The setting is
stored in `.draft-loop/retrieval-mode.json` beside `workspace.json` and is read
once when a run starts or resumes.

- `lexical` (the default) uses keyword retrieval only.
- `semantic` searches by meaning with the [local embedding
  model](#local-embedding-model) of the chosen tier.
- `hybrid` fuses keyword and semantic results.

```sh
pnpm --filter @draft-loop/cli start retrieval mode ./workspace
pnpm --filter @draft-loop/cli start retrieval mode ./workspace semantic
pnpm --filter @draft-loop/cli start retrieval mode ./workspace hybrid --tier 97m
pnpm --filter @draft-loop/cli start retrieval mode ./workspace hybrid --json
```

The workspace argument is required. Without a mode the command shows the
current mode and model tier. `--tier` (`311m`, `97m`, or `eg2-text`) can only be given with a
mode; when omitted, the saved tier is kept, starting from `311m`. `--model-dir`
overrides the model directory, as for `embeddings`. Both forms accept `--json`.

For `semantic` and `hybrid`, the command also reports the local model state for
the tier (a local check, with no network request). When the model is not
`ready`, it prints the `embeddings install` command to run. The mode is saved
either way, and nothing is downloaded. The setting never starts a run.

In a run, the mode works as follows:

- **Scope.** The mode applies only to the primary job-requirement query. The
  contact, chronology, priority, skills, and required-section queries stay
  lexical, and the provider byte and chunk limits are unchanged.
- **Sensitivity.** Chunks withheld by [source sensitivity](#source-sensitivity)
  are removed from semantic and hybrid hits before selection and tracing, as
  for lexical hits.
- **Visible fallback.** When the model is absent, corrupt, or unsupported, the
  runtime fails, or a vector index is stale, the run uses lexical retrieval and
  says so in its preflight, for example `Retrieval mode: semantic requested;
  using lexical (model-absent).` It also records a content-free
  `run.retrieval-mode` audit event and, beside each retrieval trace, a
  `semantic-unavailable` companion trace with the reason. A run that uses the
  mode prints it with the indexed chunk count and records `semantic-used`
  companions with the model identity.
- **Vectors.** Missing vectors are built from the selected exact source
  versions when a run starts, which can take a moment on first use.

### Requirement coverage in run output

When the critic is asked to judge requirement coverage, run output replaces the
generic event line for that step with a count-only summary:

```text
Coverage judgement: 3 requested, 2 satisfied, 1 not satisfied (coverage-judgement-v1)
```

Invalid and unanswered counts are added only when they are not zero, and a run
without an instructions version shows `unversioned`. No line is printed when no
judgement ran.

`status` also lists each requirement's assessment from the latest completed
critic execution of the current round, in requirement order. Each row shows the
status, the basis (`matching wording`, `strict rule`, `semantic candidate (needs
judgement)`, or `critic judgement`), the rationale, and the cited block ids.
Requirement and block text is never printed.

```text
Requirement coverage (round 1):
  [covered] req-1 — critic judgement — The block shows production Kubernetes work.
    evidence: block-a, block-b
  [uncovered] req-2 — strict rule — Not covered under the strict degree rule.
```

The desktop review panel shows the same assessments in a **Requirement
coverage** section, chosen the same way as `status`. It lists each requirement
with a status badge, the basis, the rationale, and the cited draft blocks, which
jump to the block when it is in the draft, under a summary such as
`3 judged · 2 satisfied · 1 not satisfied`. The section is hidden when no
critic judgement was recorded for the round.

### Desktop semantic retrieval controls

When a workspace is collecting or stopped, the desktop shows a **Semantic
retrieval** section under the knowledge store. It uses the same application
contracts as the `embeddings` and `retrieval mode` commands above.

- **Model status** for the chosen tier (`311m`, `97m`, or `eg2-text`) appears as a badge:
  not installed, installing, installed, corrupt, or unsupported.
- **Install** opens an approval step that names the Hugging Face source at the
  pinned revision, the file sizes, the license, and the destination, shown as
  "DraftLoop application data" rather than a path. Nothing downloads until you
  confirm. A progress bar and **Cancel download** follow; a cancelled install
  keeps nothing. **Remove model** deletes only that tier's files.
- **Retrieval mode** (lexical, semantic, or hybrid) is saved per workspace. When
  the mode needs a model that is not installed, the section says that runs fall
  back to keyword retrieval until it is.

The main process stores models in `models` under the desktop's application data
directory and sets `DRAFT_LOOP_EMBEDDING_MODEL_ROOT` to it at startup unless you
already set that variable, so runs started from the desktop read the same
directory. The renderer never receives this path.

### Desktop knowledge operations

The desktop exposes the same CKB operations through a native boundary. Renderer
messages never accept or return filesystem paths; the host owns native pickers
and keeps paths local.

- **Store access and inspection.** Desktop selection accepts only stores the host
  has opened, either in this session or by restoring the workspace's saved
  store on reopen. Combining CKBs requires visible approval. Both the CLI
  and desktop can create, rename, and archive additional CKBs, while bounded
  diagnostics omit roots, labels, filenames, URLs, checksums, and content.
  Archival requires confirmation and cannot target the default CKB.

- **Saved store on reopen.** When a workspace opens, the knowledge panel
  reopens the store saved with its selection, marks the selected CKB "In use",
  and shows no path. If the saved location is no longer readable, the panel asks
  you to open the store again. Only the first saved entry's store is restored.

- **File and URL intake.** Single-file intake uses a dedicated native picker and
  returns only opaque source and version identities. URL intake requires
  approval and applies the shared HTTPS and network-safety checks without
  returning the URL or its content.

- **Versions, status, and refresh.** Appending a file version preserves its
  origin binding and reports whether the managed bytes created a version or
  matched the current one. Path-free controls expose lifecycle and refresh
  state. File refresh uses the remembered origin; URL refresh requires fresh
  approval and repeats the intake safety checks.

- **File rebinding and retirement.** Exact-byte origin rebinding uses
  runtime-only CLI input or the native desktop picker and returns only status
  and the binding timestamp. Logical retirement is idempotent, preserves
  evidence, and requires confirmation. Retired sources cannot be reactivated.
  The knowledge base stays usable: a retired source is excluded from runs and
  profiles, and its evidence is kept.

- **Directory intake.** CLI users choose a local path; the desktop offers a
  native directory picker or **Import workspace candidate sources**. The latter
  requires explicit approval and an open collecting or stopped workspace. Its
  host resolves the configured candidate-source directory; importing does not
  select a base or start a provider workflow. Complete and partial results
  contain only scan counts and opaque source or version identities; roots,
  filenames, labels, hashes, and content remain local.

- **Directory rebinding.** Preview and confirmed apply are separate operations.
  Apply rescans the selected root and updates member origins atomically only
  when every historical member still matches exactly.

- **Directory refresh and additions.** Refresh separates read-only preview from
  confirmed apply. Apply records current and missing observations and appends
  changed same-member bytes in source-ID order. Adding members also requires
  confirmation. Both operations report deterministic, path-free complete or
  partial progress.

- **Moved members and reconciliation.** Moved-candidate preview returns only
  unique exact-integrity matches. A confirmed member move rescans the directory,
  changes only the selected origin, and returns `moved` or idempotent `current`.
  Reconciliation retires only explicitly approved missing members, and never
  retires sources after an incomplete scan.

- **Portable backup and restore.** Export requires an approved new destination
  and returns path-free integrity counts. Restore re-verifies the package and
  publishes only to an approved new store with the explicit
  `fail-if-destination-exists` policy. Logical identities are preserved, but all
  sources remain unbound from their original machine.

Portable packages exclude machine-local origins, active locks, recovery
journals, application or provider credentials, and unrelated workspace data.
Confirmed deletion is limited to archived non-default CKBs and requires the
exact token from a fresh path-free preview. DraftLoop removes only ownership-
verified managed data, preserves unknown filesystem entries, and blocks on
unmanaged database records or active preservation overrides. External backups,
exports, and copies remain independent user-controlled data.
