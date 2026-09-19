# Installed-app acceptance

The installed-app acceptance workflow runs the packaged Electron application
twice on Linux x64, macOS arm64, and Windows x64. It uses a safely sanitized
candidate Markdown file and a deterministic local response for an explicitly
approved job URL. It does not contact a model provider or fetch the public
internet.

The first launch creates a demo workspace, imports the candidate file, ingests
the approved job URL, acknowledges the provider transmission preflight, runs
the author–critic fixture, requests a revision, and verifies URL provenance.
The second launch reopens the workspace, resumes the run, approves the revised
artifact, exports Markdown, DOCX, and PDF, and checks durable history and
workspace metadata.

Each matrix job uploads a JSON artifact containing only the app version,
packaged executable checksum, OS metadata, boolean workflow results, and
limitations. It does not contain candidate text, the job URL, credentials, or
provider traffic. Credential lifecycle results are produced by the separate
[credential acceptance workflow](credential-acceptance.md).

Run the harness locally against a packaged executable:

```text
pnpm desktop:acceptance -- <packaged-executable> <evidence.json>
```

This is installed-app integration evidence for sanitized offline material. It
does not by itself validate live provider authentication, provider response
quality, or the consented real-application outcome required by later roadmap
issues.
