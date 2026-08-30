# Canonical candidate profile acceptance

**Status:** Validated with deterministic, safely sanitized representative input  
**Recorded:** 2026-08-30  
**Scope:** Canonical candidate profile outcome in issue #66; this is not a
v0.8 milestone exit or a live-provider quality claim.

## Result

The representative fixture passes through a real temporary Candidate Knowledge
Base, canonical derivation, workspace-local SQLite persistence, schema
serialization, and database restart. Its extractor is deterministic so the
test measures the application-owned profile contract rather than provider
variability.

| Check | Result |
| --- | --- |
| Career-history categories | 12 of 12 preserved |
| Fact provenance | 12 of 12 facts link to the exact candidate-provided CKB source version |
| Private project | Preserved with candidate-provided provenance and no public-corroboration requirement |
| Provider boundary | Source text is present; local paths, roots, store IDs, and knowledge-base IDs are absent |
| Profile boundary | Canonical JSON is path-free and parses back to the same profile |
| Persistence | Exact profile survives SQLite close and reopen |
| Review issues | One title conflict, one duplicate, and one omission remain open and visible |
| Silent conflict choice | Neither conflicting title is discarded |
| Review gate | Unresolved issues prevent reviewed status |

The issue fixture uses synthetic Example identities, an `.invalid` approved
link, and an explicitly private project. It contains no real candidate data.

## Reproduce

From the repository root:

```text
pnpm exec vitest run packages/application/src/candidate-profile-acceptance.test.ts
pnpm validate
```

The executable evidence is
[`candidate-profile-acceptance.test.ts`](../packages/application/src/candidate-profile-acceptance.test.ts).
Existing storage tests separately cover migrations, immutable history,
whole-workspace backup and restore, retention, and preservation of approved
exports. Profile-derived retrieval indexes do not exist yet; issue #80 owns
their construction and lifecycle cleanup rather than making this validation
claim about a nonexistent index.
