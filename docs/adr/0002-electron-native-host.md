# ADR 0002: Electron host for the local desktop alpha

- Status: Accepted
- Date: 2026-08-12
- Decision owners: DraftLoop maintainers

## Context

The renderer-side capability contract needs a real host before the local alpha
can create workspaces, invoke the shared application service, and recover a
run after restart. The project is already TypeScript/React/Vite, and the
desktop host must also package the optional native SQLite dependency.

## Decision

Use Electron 43 with Electron Forge 7 and its Vite plugin for the first native
desktop host. Electron's official distribution guidance recommends Forge for
packaging, while the Vite plugin gives the main process, preload, and renderer
separate build targets.

The host is split into three explicit layers:

1. The renderer calls only the typed `NativeBridge` exposed by preload.
2. The preload exposes a frozen, single-channel API through `contextBridge`.
3. The Electron main process validates every command, owns dialogs and
   filesystem access, and invokes the shared `@draft-loop/application` driver.

The main window uses `contextIsolation`, `sandbox`, `webSecurity`, and
`nodeIntegration: false`. Navigation and new-window requests are denied. The
host restricts imported files to the workspace evidence directory and exports
to the workspace exports directory. SQLite's native module is unpacked by
Forge's native-module plugin.

Provider credentials are never accepted from the renderer. The host boundary
supports an app-owned credential collection callback and stores encrypted
values through Electron `safeStorage`, which delegates encryption to the
operating system. The callback remains unavailable in the offline alpha until
an explicit credential prompt is designed.

## Alternatives considered

- Tauri: attractive smaller runtime, but it introduces a Rust host and a
  second application/runtime toolchain before the TypeScript workflow is
  integrated.
- Browser-only shell: preserves the existing fixture fallback but cannot
  provide filesystem dialogs, SQLite restart recovery, or packaged delivery.
- Electron Builder: viable, but Forge is the packaging path recommended by
  Electron's documentation and is sufficient for the first ZIP artifact.

## Consequences

The alpha now has one local application driver shared by CLI and desktop, a
real native bridge, and a testable restart path for workspace state and review
decisions. Electron and native SQLite increase installer size and require
platform-specific packaging/signing work before a production beta. The Forge
Vite plugin is still marked experimental, so upgrades remain a deliberate
maintenance task.

Production signing, auto-update, crash recovery, and a user-facing credential
prompt remain later beta work.
