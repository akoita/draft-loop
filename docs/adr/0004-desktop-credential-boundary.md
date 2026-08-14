# ADR 0004: Desktop credential input, storage, and provider preflight

- Status: Accepted
- Date: 2026-08-15
- Decision owners: DraftLoop maintainers
- Supersedes: The credential-handling statements in
  [ADR 0002](0002-electron-native-host.md)

## Context

ADR 0002 originally kept provider credentials out of the renderer and deferred
the credential prompt. The desktop now supports live Anthropic and OpenAI runs,
so a user needs to set, inspect, and remove provider credentials without giving
the renderer filesystem access or exposing stored secrets back to it.

The current Electron boundary has three relevant properties:

- the renderer is sandboxed and reaches the main process through one frozen,
  typed `NativeBridge` exposed by preload;
- `CredentialSetInput` necessarily contains the API key while the user enters
  it and while the IPC request is in flight; and
- Electron `safeStorage` is not available with equivalent protection on every
  supported host, so the implementation has a local encrypted-file fallback.

Candidate inputs may contain personal or confidential material. Possessing a
credential must therefore never be treated as consent to transmit a workspace
to a provider.

## Decision

Use an allowlisted renderer-to-main credential command with main-process-owned
persistence and a separate provider-transmission preflight.

1. The renderer may submit only `credential.status`, `credential.set`, and
   `credential.remove` through the existing single IPC channel. It never
   receives a stored key value.
2. `validateBridgeCommand` validates the command shape, supported provider, and
   non-empty key before the Electron host handles it. IPC payloads containing a
   key must not be logged, persisted as run history, or included in diagnostics
   or error messages.
3. The main process owns credential lookup and persistence through
   `createSafeStorageCredentialStore`. App-managed credentials are stored in
   the Electron user-data directory and environment-provided SDK credentials
   remain a supported fallback.
4. When Electron reports encryption available, the host encrypts the credential
   through `safeStorage`. Otherwise it uses AES-256-GCM with a locally generated
   key stored separately from the ciphertext and restricts both files to the
   current user where the platform honors file modes.
5. The fallback is explicitly weaker than an operating-system secret store. An
   attacker able to read both local files or control the user session can
   recover the key. The UI and release evidence must not describe that fallback
   as OS-backed storage.
6. Credential presence authorizes authentication only. Before the first request
   containing source or draft material, the product must show the data class,
   provider and model, endpoint where applicable, transmission scope, retention
   preference, and run budget, then capture explicit acknowledgement. The
   provider adapter still enforces `DataExposurePolicy` immediately before the
   SDK call.
7. Credential set, status, removal, environment fallback, encryption backend,
   denied-policy behavior, and restart behavior require supported-platform
   acceptance before this flow is considered Validated.

## Alternatives considered

- **Environment variables only:** keeps keys out of renderer IPC and app-owned
  files, but makes the packaged desktop difficult to configure and offers no
  in-app status or removal workflow.
- **Main-process native credential dialog:** keeps the key out of the renderer,
  but adds a second UI system and platform-specific interaction path. This can
  be reconsidered if renderer compromise becomes an unacceptable risk.
- **OS-backed storage only, with no fallback:** provides a simpler assurance
  statement, but makes app-managed credentials unavailable when Electron cannot
  provide encryption. Failing closed remains preferable for production if the
  fallback cannot be disclosed and validated adequately.
- **Store keys in workspace configuration or SQLite:** rejected because it
  mixes credentials with candidate data, backups, retention, and run history.

## Consequences

The desktop has a practical credential workflow while filesystem access,
decryption, provider construction, and secret removal remain in the main
process. Stored secrets are never projected back to the renderer, and provider
transmission remains a separate authorization decision.

The renderer handles plaintext during entry, so renderer compromise can steal a
newly entered key. The local AES-GCM fallback does not resist an attacker with
access to both the key and ciphertext files. Environment variables and
app-managed credentials also create precedence and rotation behavior that must
be visible and tested.

The current repository enforces the provider data policy at the adapter
boundary, but the complete desktop preflight and cross-platform credential
acceptance remain work for the Integration hardening and outcome validation
stage.

## Follow-up

- Add supported-platform acceptance for `safeStorage` availability, fallback
  disclosure, restart, removal, and environment precedence.
- Complete the visible desktop transmission preflight and persist only the
  approval decision and safe metadata, never the credential or raw content.
- Add renderer-compromise and IPC-payload logging regression tests, and define a
  content security policy appropriate for the packaged renderer.
- Reconsider failing closed instead of local fallback before production beta.
- Define credential rotation and incident-response guidance before broader
  distribution.
