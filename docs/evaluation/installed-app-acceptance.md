# Installed-app acceptance

The `Installed app acceptance gate` check proves the packaged desktop client
(`apps/desktop-client`, ADR 0011, D9) starts and behaves on Linux x64, macOS
arm64 and Windows x64. It is a required check on `main`.

## When it runs

- On pull requests that can change the packaged client: its sources, its
  acceptance script, its workflow, the lockfile, `package.json` or `.nvmrc`.
  `scripts/desktop-ci-scope.mjs` decides; other pull requests skip the
  platform jobs and the gate still reports success.
- In every **Release** build before publishing, and in `pnpm release:preflight`.
- On manual dispatch of the **Installed app acceptance** workflow.

## What it checks

The harness launches the packaged client with a fresh profile
(`--user-data-dir`) against a scripted fake DraftLoop API on the runner. It
calls no provider, no real server and no public site, and uses no candidate
material.

| Check | What it proves |
| --- | --- |
| `pickerAtFirstLaunch` | A first launch shows the server picker. |
| `refusesPlainHttpElsewhere` | Plain `http` is refused for any address but this computer. |
| `opensServer` | Choosing a healthy server opens its own web screen. |
| `desktopHost` | The page reports the desktop host to the server. |
| `noNodeInPage` | The page has no Node.js access. |
| `signInHook` | The remembered sign-in bridge is present. |
| `outsideLinksLeave` | Links to other sites open in the system browser. |
| `otherSchemesBlocked` | Other link schemes are blocked. |
| `relaunchOpensLastServer` | A relaunch opens the last server without the picker. |

Each platform job uploads a JSON file with the platform, the architecture and
these booleans. It holds no token, address or page content.

## Run it locally

Package the client, then run the harness. On Linux and WSL it needs a display,
such as WSLg or `xvfb-run`.

```text
pnpm --filter @draft-loop/desktop-client package
pnpm desktop-client:acceptance
```

Without arguments the harness finds the executable that `package` wrote. To
name it and keep the evidence, pass both paths:
`pnpm desktop-client:acceptance -- <packaged-executable> <evidence.json>`.

If packaging stops at the Vite build, read Vite's error above the failure:
`apps/desktop-client/vite-build-guard.ts` stops Forge from reporting a broken
bundle as built. If a check fails, the evidence names it; rerun locally with
the same executable.

This is offline evidence for the client shell. It does not validate sign-in
against a real identity provider, a real keychain, or draft quality.
