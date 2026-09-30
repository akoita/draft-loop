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

```sh
pnpm --filter @draft-loop/cli start model-profiles
pnpm --filter @draft-loop/cli start start ./workspace --model-preset economy
pnpm --filter @draft-loop/cli start start ./workspace --model-preset standard
pnpm --filter @draft-loop/cli start start ./workspace \
  --author-profile standard-anthropic-author@1 \
  --critic-profile standard-openai-critic@2
```

`start` accepts either one pair preset or both exact `--author-profile` and
`--critic-profile` references. Each reference uses `profile-id@version` and
must support its selected role. Economy and standard are unvalidated opt-in
pairs. The active catalog contains four exact profile versions; older profile
versions remain available for historical references but are not current
choices. A CLI-selected pair is recorded on that run only. It does not change
workspace model settings, transmission approval, or credentials. Resume uses
the pair already recorded in run history. Omitting profile options preserves
the existing workspace-configured behavior.

Profile selection requires a supported configured authentication route. Current
OpenAI Codex user-session and local routes reject profile selections; the CLI
does not switch authentication modes automatically. Account and provider
availability remains unchecked.

## Desktop diagnostics

Packaged builds keep host-error diagnostics in `diagnostics/host-errors.jsonl`
under Electron’s local `userData` directory. This is the same application data
location used for credential and authentication preferences. Electron places it
under the application’s folder in `%APPDATA%` on Windows, `$XDG_CONFIG_HOME`
(or `~/.config`) on Linux, and `~/Library/Application Support` on macOS.

Each line contains only an ISO timestamp, capability, recognized error class,
and recognized bridge or provider code. Messages, stacks, filesystem paths,
filenames, source content, and provider responses are excluded. The current log
and one rotated backup are each bounded to 64 KiB. Logging failures do not
interrupt a review operation. Logs stay local and are not uploaded automatically.

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

If extraction fails, it saves no facts and returns one omission issue with
opaque source references. Recognized provider failures provide fixed action
guidance; unrecognized errors and provider diagnostics are never shown. Input
preparation, response format, and grounding failures have distinct messages.
For Anthropic structured output, the SDK normalizes the provider-facing JSON
schema; application-side schema and source-grounding checks remain authoritative.

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
opens the same discovery and independence checks used during workspace setup.
Saving replaces the author and critic pair for future runs without changing the
workspace name, round limit, or existing run records. A changed provider
transmission identity requires fresh acknowledgement before a later run starts
or resumes; saving settings never sends candidate material to a provider.

The native host can report which registered exact profiles the active
workspace's configured authentication routes support. This is local metadata
and makes no credential or provider calls. In collecting or stopped workspaces,
the desktop offers presets and role-specific exact profile choices when both
model-configuration and route-support capabilities are available. Choices stay
a draft until **Apply for future runs** saves their provider/model destinations.
The renderer keeps the exact references for new starts; existing run records
remain unchanged. Unsupported or unavailable routes block profile-backed starts,
and provider-transmission acknowledgement is still required. OpenAI Codex
user-session routes do not support these profiles, and authentication is never
switched automatically.

For a selected draft pair, the picker also provides an editable API token-cost
scenario based on the catalog's dated public, uncached text API rates. Its
initial 10,000-input/1,000-output-token example plans two author calls and one
critic call; change the values to describe another scenario. The estimate is
not a forecast, hard cap, or bill and does not set runtime token budgets. It
excludes extra calls and retries, input growth, cache, tools, batch, regional
premiums, and unsupported long context. User-session routes show public rates
only and do not estimate subscription quota or charges. The reusable
application boundary is `@draft-loop/application/model-profile-budget`.

**Use workspace models** keeps the saved provider/model destinations and uses
legacy controls for the next start. The next-run profile choice belongs to the
current window; manual model saves and workspace changes clear it.

When provider model discovery fails or returns no IDs, the setup and **Change
models** forms offer exact IDs from the active application profile catalog.
Labels show only each entry's configured tier and registered author or critic
role. These fields do not establish account, plan, or CV-quality suitability.
Suggested IDs are not guaranteed to work with your account, plan, or CLI version.
You can still enter any exact model ID, and successful live discovery remains
the displayed source. The catalog was reviewed on 2026-09-30; CLI-specific live
availability for these suggestions has not been reverified. Economy and
standard are the two unvalidated pair presets. The active catalog lists
Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Luna, and GPT-6.1 Sol. Historical
profile versions, including premium-tier entries, remain resolvable but are
not offered as current suggestions or presets. All catalog quality entries
are unvalidated and availability has not been checked; the review date
documents metadata review, not a live provider probe. Local endpoints remain
free-text because there are no local server profile IDs.

Catalog price metadata covers the standard, uncached text API at up to 200,000
input tokens. It excludes cache, tool, batch, regional, and subscription
pricing. Sources are the official [Anthropic model overview] and [Sonnet 5.5
overview], plus official OpenAI pages for [GPT-6.1 Sol] and [GPT-6 Luna].

[Anthropic model overview]: https://platform.claude.com/docs/en/models/overview
[Sonnet 5.5 overview]: https://platform.claude.com/docs/en/models/sonnet-5-5/overview
[GPT-6.1 Sol]: https://developers.openai.com/api/docs/models/gpt-6.1-sol
[GPT-6 Luna]: https://developers.openai.com/api/docs/models/gpt-6-luna

## Writing policies

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

### Desktop knowledge operations

The desktop exposes the same CKB operations through a native boundary. Renderer
messages never accept or return filesystem paths; the host owns native pickers
and keeps paths local.

- **Store access and inspection.** Desktop selection accepts only stores opened
  in the current session. Combining CKBs requires visible approval. Both the CLI
  and desktop can create, rename, and archive additional CKBs, while bounded
  diagnostics omit roots, labels, filenames, URLs, checksums, and content.
  Archival requires confirmation and cannot target the default CKB.

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
