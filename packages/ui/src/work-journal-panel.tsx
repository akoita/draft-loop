import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";
import { knowledgeBaseChoice } from "./knowledge-base-choice.js";
import { workJournalPanelId } from "./shared-link.js";
import {
  type WorkJournalAgentNames,
  type WorkJournalEditDraft,
  type WorkJournalReviewAction,
  type WorkJournalReviewItem,
  type WorkJournalReviewNote,
  type WorkJournalRole,
  type WorkJournalTier,
  workJournalEditDraft,
  workJournalEditedContent,
  workJournalPeriod,
  workJournalProvenance,
  workJournalReviewItems,
  workJournalRoleLabel,
  workJournalScreening,
} from "./work-journal-model.js";

/**
 * The Work journal on the Career evidence page (#2024): the notes an agent recorded wait
 * here until the candidate approves, edits, merges or discards each one. The switch that lets
 * agents add notes is in Workspace settings (#2625); the panel says how it is set. A host that
 * serves the work journal provides it as a host panel; the desktop has none.
 */

export interface WorkJournalKnowledgeBase {
  readonly id: string;
  readonly name: string;
}

export interface WorkJournalPanelProps {
  /** Whether notes from agents are accepted; undefined until read. */
  readonly intake: boolean | undefined;
  /** Every note the API returned; undefined until read. */
  readonly notes: readonly WorkJournalReviewNote[] | undefined;
  /** Why the journal could not be read, if it could not. */
  readonly problem?: string | undefined;
  /** Where an approved note can go; the first is preselected. */
  readonly knowledgeBases: readonly WorkJournalKnowledgeBase[];
  /** Resolves with a problem to show, or undefined once the review is saved. */
  readonly onReview: (
    noteId: string,
    action: WorkJournalReviewAction,
  ) => Promise<string | undefined>;
  /** Opens Agents in Workspace settings, where the switch is (#2625); no link without it. */
  readonly onOpenSettings?: (() => void) | undefined;
  /** Agent token names by id, so a note says which agent filed it; ids show without it. */
  readonly agentNames?: WorkJournalAgentNames | undefined;
}

export function WorkJournalPanel({
  intake,
  notes,
  problem,
  knowledgeBases,
  onReview,
  onOpenSettings,
  agentNames,
}: WorkJournalPanelProps) {
  const id = useId();
  const items = notes === undefined ? undefined : workJournalReviewItems(notes);

  return (
    <section
      id={workJournalPanelId}
      className="panel host-panel work-journal"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>{t`Work journal`}</h2>
      <p className="muted">{t`Agents can record notable work you shipped. Each note waits here; only the notes you approve become career evidence.`}</p>
      {intake === undefined ? null : (
        <p className="muted work-journal-intake-status">
          {intake ? t`Agents can add notes.` : t`Agents cannot add notes yet.`}{" "}
          {onOpenSettings === undefined ? null : (
            <button type="button" className="link-action" onClick={onOpenSettings}>
              {intake ? t`Change in Workspace settings` : t`Turn on in Workspace settings`}
            </button>
          )}
        </p>
      )}
      {problem === undefined ? null : (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {items === undefined ? (
        problem === undefined ? (
          <p role="status">{t`Reading the work journal…`}</p>
        ) : null
      ) : items.length === 0 ? (
        <p className="muted">{t`No notes wait for review.`}</p>
      ) : (
        <ul className="work-journal-notes">
          {items.map((item) => (
            <li key={item.note.id}>
              <WorkJournalReviewCard
                item={item}
                knowledgeBases={knowledgeBases}
                onReview={onReview}
                agentNames={agentNames}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WorkJournalNoteDetails({
  note,
  agentNames,
}: {
  readonly note: WorkJournalReviewNote;
  readonly agentNames?: WorkJournalAgentNames | undefined;
}) {
  const { content } = note;
  const screening = workJournalScreening(note.screening);
  const provenance = workJournalProvenance(note, agentNames);
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
      {provenance === null ? null : <p className="muted">{provenance}</p>}
      <p className="muted">
        {content.technologies.join(", ")} ·{" "}
        {content.candidate_role.map(workJournalRoleLabel).join(", ")}
      </p>
      {content.links.length === 0 ? null : (
        <details className="work-journal-links">
          <summary>{plural(content.links.length, { one: "# link", other: "# links" })}</summary>
          <ul>
            {content.links.map((link) => (
              <li key={link.url}>
                {link.kind}:{" "}
                <a href={link.url} rel="noreferrer noopener" target="_blank">
                  {link.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const tiers = (): readonly { readonly value: WorkJournalTier | ""; readonly label: string }[] => [
  { value: "", label: t`Default for the project's visibility` },
  { value: "normal", label: t`Normal` },
  { value: "sensitive", label: t`Sensitive` },
  { value: "never-share", label: t`Never share` },
];

const roles: readonly WorkJournalRole[] = ["designed", "implemented", "directed", "reviewed"];

type Mode = "approve" | "merge" | "edit" | "discard";

interface WorkJournalReviewCardProps {
  readonly item: WorkJournalReviewItem;
  readonly knowledgeBases: readonly WorkJournalKnowledgeBase[];
  readonly onReview: WorkJournalPanelProps["onReview"];
  readonly agentNames?: WorkJournalAgentNames | undefined;
}

/** One pending note, its likely duplicates beside it, and the review actions, Approve first. */
export function WorkJournalReviewCard({
  item,
  knowledgeBases,
  onReview,
  agentNames,
}: WorkJournalReviewCardProps) {
  const id = useId();
  const { note, duplicates } = item;
  const held = workJournalScreening(note.screening).held;
  // Approve by default: a likely duplicate is only a hint, and merging two distinct pieces of
  // work by one click loses one of them.
  const [chosen, setChosen] = useState<Mode>(held ? "edit" : "approve");
  const [chosenKnowledgeBaseId, setKnowledgeBaseId] = useState("");
  const knowledgeBaseId = knowledgeBaseChoice(knowledgeBases, chosenKnowledgeBaseId);
  const [tier, setTier] = useState<WorkJournalTier | "">("");
  const [into, setInto] = useState(duplicates[0]?.id ?? "");
  const [keepSummary, setKeepSummary] = useState<"into" | "this">("into");
  const [draft, setDraft] = useState<WorkJournalEditDraft>(() =>
    workJournalEditDraft(note.content),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const modes: readonly Mode[] = [
    ...(held ? [] : (["approve"] as const)),
    ...(duplicates.length > 0 ? (["merge"] as const) : []),
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
          setProblem(t`Choose the knowledge base the note goes to.`);
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
        <WorkJournalNoteDetails note={note} agentNames={agentNames} />
        {duplicates.map((duplicate) => (
          <div key={duplicate.id} className="work-journal-duplicate">
            <p className="muted">{t`Likely the same work:`}</p>
            <WorkJournalNoteDetails note={duplicate} agentNames={agentNames} />
          </div>
        ))}
      </div>
      {held ? (
        <p className="muted">{t`Screening held this note back. Edit it so it screens clear, or discard it.`}</p>
      ) : null}
      <fieldset className="work-journal-actions">
        <legend>{t`Review`}</legend>
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
            {modeLabels()[value]}
          </label>
        ))}
      </fieldset>
      {current === "approve" ? (
        <div className="work-journal-form">
          <label htmlFor={`${id}-base`}>{t`Knowledge base`}</label>
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
          <label htmlFor={`${id}-tier`}>{t`Sensitivity`}</label>
          <select
            id={`${id}-tier`}
            value={tier}
            onChange={(event) => setTier(event.target.value as WorkJournalTier | "")}
          >
            {tiers().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {current === "merge" ? (
        <div className="work-journal-form">
          <label htmlFor={`${id}-into`}>{t`Merge into`}</label>
          <select id={`${id}-into`} value={into} onChange={(event) => setInto(event.target.value)}>
            {duplicates.map((duplicate) => (
              <option key={duplicate.id} value={duplicate.id}>
                {duplicate.content.title}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-summary`}>{t`Summary to keep`}</label>
          <select
            id={`${id}-summary`}
            value={keepSummary}
            onChange={(event) => setKeepSummary(event.target.value as "into" | "this")}
          >
            <option value="into">{t`The other note's`}</option>
            <option value="this">{t`This note's`}</option>
          </select>
          <p className="muted">{t`Links and technologies are combined and the period widened.`}</p>
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
          {busy ? t`Saving…` : submitLabels()[current]}
        </button>
      </div>
    </article>
  );
}

const modeLabels = (): Readonly<Record<Mode, string>> => ({
  approve: t`Approve`,
  merge: t`Merge`,
  edit: t`Edit`,
  discard: t`Discard`,
});

const submitLabels = (): Readonly<Record<Mode, string>> => ({
  approve: t`Approve as career evidence`,
  merge: t`Merge the notes`,
  edit: t`Save the edit`,
  discard: t`Discard the note`,
});

interface WorkJournalEditFormProps {
  readonly id: string;
  readonly draft: WorkJournalEditDraft;
  readonly onChange: (draft: WorkJournalEditDraft) => void;
}

function WorkJournalEditForm({ id, draft, onChange }: WorkJournalEditFormProps) {
  return (
    <div className="work-journal-form">
      <label htmlFor={`${id}-title`}>{t`Title`}</label>
      <input
        id={`${id}-title`}
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <label htmlFor={`${id}-text`}>{t`Summary`}</label>
      <textarea
        id={`${id}-text`}
        value={draft.summary}
        onChange={(event) => onChange({ ...draft, summary: event.target.value })}
      />
      <label htmlFor={`${id}-technologies`}>{t`Technologies, separated by commas`}</label>
      <input
        id={`${id}-technologies`}
        value={draft.technologies}
        onChange={(event) => onChange({ ...draft, technologies: event.target.value })}
      />
      <fieldset>
        <legend>{t`What the candidate did`}</legend>
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
      <label htmlFor={`${id}-visibility`}>{t`Project visibility`}</label>
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
        <option value="private">{t`Private: its repository and links are never sent`}</option>
        <option value="unknown">{t`Unknown: treated as private`}</option>
        <option value="public">{t`Public`}</option>
      </select>
    </div>
  );
}
