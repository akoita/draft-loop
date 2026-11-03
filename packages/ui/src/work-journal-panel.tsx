import { useId, useState } from "react";

import {
  type WorkJournalEditDraft,
  type WorkJournalReviewAction,
  type WorkJournalReviewItem,
  type WorkJournalReviewNote,
  type WorkJournalRole,
  type WorkJournalTier,
  workJournalEditDraft,
  workJournalEditedContent,
  workJournalPeriod,
  workJournalReviewItems,
  workJournalRoleLabel,
  workJournalScreening,
} from "./work-journal-model.js";

/**
 * The Work journal on the Career evidence page (#2024): the notes a coding agent recorded wait
 * here until the candidate approves, edits, merges or discards each one. A host that serves the
 * work journal provides it as a host panel; the desktop has none.
 */

export interface WorkJournalKnowledgeBase {
  readonly id: string;
  readonly name: string;
}

export interface WorkJournalPanelProps {
  /** Whether notes from coding agents are accepted; undefined until read. */
  readonly intake: boolean | undefined;
  /** Every note the API returned; undefined until read. */
  readonly notes: readonly WorkJournalReviewNote[] | undefined;
  /** Why the journal could not be read, if it could not. */
  readonly problem?: string | undefined;
  /** Where an approved note can go; the first is preselected. */
  readonly knowledgeBases: readonly WorkJournalKnowledgeBase[];
  /** Resolves with a problem to show, or undefined once saved. */
  readonly onSetIntake: (enabled: boolean) => Promise<string | undefined>;
  /** Resolves with a problem to show, or undefined once the review is saved. */
  readonly onReview: (
    noteId: string,
    action: WorkJournalReviewAction,
  ) => Promise<string | undefined>;
}

export function WorkJournalPanel({
  intake,
  notes,
  problem,
  knowledgeBases,
  onSetIntake,
  onReview,
}: WorkJournalPanelProps) {
  const id = useId();
  const [intakeProblem, setIntakeProblem] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const items = notes === undefined ? undefined : workJournalReviewItems(notes);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setIntakeProblem(await onSetIntake(enabled));
    setSaving(false);
  }

  return (
    <section className="panel host-panel work-journal" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Work journal</h2>
      <p className="muted">
        Coding agents can record notable work you shipped. Each note waits here; only the notes you
        approve become career evidence.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={intake === true}
          disabled={intake === undefined || saving}
          onChange={(event) => void toggle(event.target.checked)}
        />{" "}
        Accept notes from coding agents
      </label>
      {intakeProblem === undefined ? null : (
        <p className="problem" role="alert">
          {intakeProblem}
        </p>
      )}
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {items === undefined ? (
        problem === undefined ? (
          <p role="status">Reading the work journal…</p>
        ) : null
      ) : items.length === 0 ? (
        <p className="muted">No notes wait for review.</p>
      ) : (
        <ul className="work-journal-notes">
          {items.map((item) => (
            <li key={item.note.id}>
              <WorkJournalReviewCard
                item={item}
                knowledgeBases={knowledgeBases}
                onReview={onReview}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WorkJournalNoteDetails({ note }: { readonly note: WorkJournalReviewNote }) {
  const { content } = note;
  const screening = workJournalScreening(note.screening);
  return (
    <div className="work-journal-note">
      <h3>{content.title}</h3>
      <p>
        <span className={`screening screening-${screening.kind}`}>
          <span className="screening-label">{screening.label}</span>
        </span>{" "}
        <span className="muted">
          {workJournalPeriod(content.period)} · {content.project.name} ({content.project.visibility}
          )
        </span>
      </p>
      <p>{content.summary}</p>
      <p className="muted">
        {content.technologies.join(", ")} ·{" "}
        {content.candidate_role.map(workJournalRoleLabel).join(", ")}
      </p>
      {content.links.length === 0 ? null : (
        <ul className="work-journal-links">
          {content.links.map((link) => (
            <li key={link.url}>
              {link.kind}:{" "}
              <a href={link.url} rel="noreferrer noopener" target="_blank">
                {link.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const tiers: readonly { readonly value: WorkJournalTier | ""; readonly label: string }[] = [
  { value: "", label: "Default for the project's visibility" },
  { value: "normal", label: "Normal" },
  { value: "sensitive", label: "Sensitive" },
  { value: "never-share", label: "Never share" },
];

const roles: readonly WorkJournalRole[] = ["designed", "implemented", "directed", "reviewed"];

type Mode = "approve" | "merge" | "edit" | "discard";

interface WorkJournalReviewCardProps {
  readonly item: WorkJournalReviewItem;
  readonly knowledgeBases: readonly WorkJournalKnowledgeBase[];
  readonly onReview: WorkJournalPanelProps["onReview"];
}

/** One pending note, its likely duplicates beside it, and the four review actions. */
export function WorkJournalReviewCard({
  item,
  knowledgeBases,
  onReview,
}: WorkJournalReviewCardProps) {
  const id = useId();
  const { note, duplicates } = item;
  const held = workJournalScreening(note.screening).held;
  const [chosen, setChosen] = useState<Mode>(
    item.suggested === "merge" ? "merge" : held ? "edit" : "approve",
  );
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? "");
  const [tier, setTier] = useState<WorkJournalTier | "">("");
  const [into, setInto] = useState(duplicates[0]?.id ?? "");
  const [keepSummary, setKeepSummary] = useState<"into" | "this">("into");
  const [draft, setDraft] = useState<WorkJournalEditDraft>(() =>
    workJournalEditDraft(note.content),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const modes: readonly Mode[] = [
    ...(duplicates.length > 0 ? (["merge"] as const) : []),
    ...(held ? [] : (["approve"] as const)),
    "edit",
    "discard",
  ];
  const current = modes.includes(chosen) ? chosen : (modes[0] ?? "edit");

  async function send(action: WorkJournalReviewAction) {
    setBusy(true);
    const refused = await onReview(note.id, action);
    setBusy(false);
    setProblem(refused);
  }

  function submit() {
    switch (current) {
      case "approve":
        if (knowledgeBaseId === "") {
          setProblem("Choose the knowledge base the note goes to.");
          return;
        }
        void send({
          action: "approve",
          knowledge_base_id: knowledgeBaseId,
          ...(tier === "" ? {} : { tier }),
        });
        return;
      case "merge":
        void send({ action: "merge", into, keep_summary: keepSummary });
        return;
      case "edit": {
        const edited = workJournalEditedContent(note.content, draft);
        if ("problem" in edited) {
          setProblem(edited.problem);
          return;
        }
        void send({ action: "edit", content: edited.content });
        return;
      }
      case "discard":
        void send({ action: "discard" });
        return;
    }
  }

  return (
    <article className="work-journal-card" aria-label={note.content.title}>
      <div className={duplicates.length > 0 ? "work-journal-compare" : undefined}>
        <WorkJournalNoteDetails note={note} />
        {duplicates.map((duplicate) => (
          <div key={duplicate.id} className="work-journal-duplicate">
            <p className="muted">Likely the same work:</p>
            <WorkJournalNoteDetails note={duplicate} />
          </div>
        ))}
      </div>
      {held ? (
        <p className="muted">
          Screening held this note back. Edit it so it screens clear, or discard it.
        </p>
      ) : null}
      <fieldset className="work-journal-actions">
        <legend>Review</legend>
        {modes.map((value) => (
          <label key={value} className="radio">
            <input
              type="radio"
              name={`${id}-mode`}
              value={value}
              checked={current === value}
              onChange={() => {
                setChosen(value);
                setProblem(undefined);
              }}
            />{" "}
            {modeLabels[value]}
          </label>
        ))}
      </fieldset>
      {current === "approve" ? (
        <div className="work-journal-form">
          <label htmlFor={`${id}-base`}>Knowledge base</label>
          <select
            id={`${id}-base`}
            value={knowledgeBaseId}
            onChange={(event) => setKnowledgeBaseId(event.target.value)}
          >
            {knowledgeBases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-tier`}>Sensitivity</label>
          <select
            id={`${id}-tier`}
            value={tier}
            onChange={(event) => setTier(event.target.value as WorkJournalTier | "")}
          >
            {tiers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {current === "merge" ? (
        <div className="work-journal-form">
          <label htmlFor={`${id}-into`}>Merge into</label>
          <select id={`${id}-into`} value={into} onChange={(event) => setInto(event.target.value)}>
            {duplicates.map((duplicate) => (
              <option key={duplicate.id} value={duplicate.id}>
                {duplicate.content.title}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-summary`}>Summary to keep</label>
          <select
            id={`${id}-summary`}
            value={keepSummary}
            onChange={(event) => setKeepSummary(event.target.value as "into" | "this")}
          >
            <option value="into">The other note's</option>
            <option value="this">This note's</option>
          </select>
          <p className="muted">Links and technologies are combined and the period widened.</p>
        </div>
      ) : null}
      {current === "edit" ? (
        <WorkJournalEditForm id={id} draft={draft} onChange={setDraft} />
      ) : null}
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="button" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : submitLabels[current]}
        </button>
      </div>
    </article>
  );
}

const modeLabels: Readonly<Record<Mode, string>> = {
  approve: "Approve",
  merge: "Merge",
  edit: "Edit",
  discard: "Discard",
};

const submitLabels: Readonly<Record<Mode, string>> = {
  approve: "Approve as career evidence",
  merge: "Merge the notes",
  edit: "Save the edit",
  discard: "Discard the note",
};

interface WorkJournalEditFormProps {
  readonly id: string;
  readonly draft: WorkJournalEditDraft;
  readonly onChange: (draft: WorkJournalEditDraft) => void;
}

function WorkJournalEditForm({ id, draft, onChange }: WorkJournalEditFormProps) {
  return (
    <div className="work-journal-form">
      <label htmlFor={`${id}-title`}>Title</label>
      <input
        id={`${id}-title`}
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <label htmlFor={`${id}-text`}>Summary</label>
      <textarea
        id={`${id}-text`}
        value={draft.summary}
        onChange={(event) => onChange({ ...draft, summary: event.target.value })}
      />
      <label htmlFor={`${id}-technologies`}>Technologies, separated by commas</label>
      <input
        id={`${id}-technologies`}
        value={draft.technologies}
        onChange={(event) => onChange({ ...draft, technologies: event.target.value })}
      />
      <fieldset>
        <legend>What the candidate did</legend>
        {roles.map((role) => (
          <label key={role} className="checkbox">
            <input
              type="checkbox"
              checked={draft.roles.includes(role)}
              onChange={(event) =>
                onChange({
                  ...draft,
                  roles: event.target.checked
                    ? roles.filter((known) => known === role || draft.roles.includes(known))
                    : draft.roles.filter((known) => known !== role),
                })
              }
            />{" "}
            {workJournalRoleLabel(role)}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-visibility`}>Project visibility</label>
      <select
        id={`${id}-visibility`}
        value={draft.visibility}
        onChange={(event) =>
          onChange({
            ...draft,
            visibility: event.target.value as WorkJournalEditDraft["visibility"],
          })
        }
      >
        <option value="private">Private: its repository and links are never sent</option>
        <option value="unknown">Unknown: treated as private</option>
        <option value="public">Public</option>
      </select>
    </div>
  );
}
