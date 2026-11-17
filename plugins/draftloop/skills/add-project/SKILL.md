---
name: add-project
description: Turn the current code repository into a DraftLoop project card the candidate reviews before it is sent.
---

# Add this repository as a project card

Use this when the candidate asks to add the current repository to their career evidence.

1. Ask for the candidate's commit emails, their role (sole author, lead or contributor) and whether the repository is public or private. Ask for its public address and live site only when public.
2. Count the numbers. Run `draft-loop evidence add-repo . --email <email>...` when it is installed. Otherwise count from `git log --no-merges --format="%ae %as" HEAD`: own commits, total commits, the candidate's first and last commit dates, and other contributors as a count. Never estimate a number.
3. Read only the README, Markdown under docs, manifests (package.json, pyproject.toml, go.mod, Cargo.toml and similar), Dockerfiles, Terraform files, release notes, and the candidate's own commit and pull request titles. Never open source files.
4. Draft the card: a one-line purpose, a summary a hiring manager reads (the problem, what it does, its scale), the stack, scale signals, and up to eight highlights, each citing the file or pull request it came from.
5. Show the whole card to the candidate and apply their changes. Send nothing until they say yes.
6. Call `add_project` with the card. Never include code, file contents, keys, or any email address, and send no links for a private repository.
7. Say that the card waits for the candidate's approval in DraftLoop's Work journal.
