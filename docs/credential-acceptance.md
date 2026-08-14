# Packaged credential acceptance

Credential lifecycle acceptance runs the packaged Electron application twice on
Linux x64, macOS arm64, and Windows x64. It uses Electron `safeStorage` from the
real main process, not a test double.

For both Anthropic and OpenAI, the first launch verifies environment fallback,
sets an app-managed synthetic canary, confirms app precedence and provider
resolution, then replaces it. The second launch verifies restart persistence
and resolution of each replacement, removes both values, and confirms that the
original process environment canaries become active. App-managed credentials
are resolved explicitly and are never copied into `process.env`.

The workflow generates high-entropy canaries in the runner process. They are not
repository constants, provider credentials, or written to evidence. The runner
checks process output, the populated encrypted credential file before removal,
credential storage after removal, and the packaged executable for plaintext
canaries. Its JSON artifact contains only app/OS metadata, Electron safeStorage
availability/backend, the reported protection for both providers, boolean
results, and named negative checks.

Run the harness against a packaged executable with:

```text
pnpm desktop:credential-acceptance -- <packaged-executable> <evidence.json>
```

Protection labels mean:

- `os-backed`: Electron encryption backed by the operating-system facility;
- `basic-text`: Electron's Linux `basic_text` backend, which is obfuscation and
  is explicitly reported as weak protection;
- `local-aes-gcm`: the DraftLoop fallback, whose encryption key and ciphertext
  share the same local user boundary;
- `environment`: an SDK-compatible process environment variable;
- `none`: no active credential.

The cross-platform workflow is implementation infrastructure. The roadmap stage
remains validation-incomplete until successful artifacts from all three matrix
jobs are reviewed and linked in the stage evidence record. Synthetic provider
resolution also does not prove successful authentication against a live model
provider.
