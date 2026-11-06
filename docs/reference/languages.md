# Languages

This page is for a candidate or coach who wants DraftLoop in another language.
DraftLoop has two separate language choices: the **screen language** of menus
and messages, and the **document language** of each CV, cover letter and set of
interview questions.

## What is supported

| Language   | Screens               | Documents                                                         |
| ---------- | --------------------- | ----------------------------------------------------------------- |
| English    | Supported             | Supported                                                         |
| French     | Beta                  | Supported; its quality gate is still running ([#583](https://github.com/akoita/draft-loop/issues/583)) |
| German, Spanish, Italian, Dutch, Portuguese | Not offered | Preview: drafts work, but prompts, checks and export are not tuned yet |

**Beta** means every screen message has a French translation, but it has not
had a professional review. Counted words ("3 runs") take each language's
plural forms. A few status lines and the document language names still show in
English. Legal pages stay in English.

## Choose the screen language

1. Open **Home** and go to **Workspace settings**.
2. Pick **English** or **Français** under **Screen language**.

The screens change at once. The choice changes no document: each CV and letter
keeps its own document language.

Where the choice is kept:

- **Signed in to the hosted service:** with your account, so every browser and
  device switches to it after you sign in. This browser keeps it too.
- **Owner token or self-hosted:** in this browser. Another browser starts from
  its own language.
- **Desktop app:** on this computer, for every server you open. The app's own
  menus, dialogs and server picker follow it too.

With nothing saved, DraftLoop uses the first browser or system language it has,
and English otherwise.

## Choose the document language

Set the workspace's language, then override it for one application on that
application's page. New application proposes the pasted job's own language when
it is confident. The [CLI and desktop reference](cli-and-desktop.md#applications)
describes the setting and its commands.

From the CLI, `draft-loop init --language fr` creates a workspace whose
documents are written in French.

## Career evidence in French

French CVs and notes work as career evidence. Their section headings, such as
**Expériences professionnelles**, **Formation** or **Compétences clés**, are
recognised like English ones, so a French CV is classified as a CV.

The CLI shows the detected language of each source with `knowledge source list`
([source evidence kind](cli-and-desktop.md#source-evidence-kind)). The web
screen does not list sources one by one yet.

Lexical search matches words, so it rarely finds French evidence for an English
job. Semantic search is built for that; the measurement is in
[cross-language retrieval](../evaluation/cross-language-retrieval.md).
