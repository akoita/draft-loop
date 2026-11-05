import { useState } from "react";

import type { ApiClient } from "./api-client.js";
import {
  type ApplicationMaterialDraft,
  type ApplicationMaterialKind,
  applicationMaterialDisclosure,
  applicationMaterialFileName,
  applicationMaterialKindLabels,
  applicationMaterialMarkdown,
  applicationMaterialProblem,
} from "./application-material-model.js";
import { useRecordId } from "./record-context.js";
import { saveFile } from "./save-file.js";

/**
 * The prepare panel on an application (#2217): the candidate picks a cover letter or interview
 * questions, reads the draft with each citation beside its paragraph, and downloads it as
 * Markdown. A refusal, such as a server without a Claude route, shows in the panel and leaves
 * the rest of the page working.
 */

export interface ApplicationMaterialViewProps {
  readonly kind: ApplicationMaterialKind;
  readonly draft: ApplicationMaterialDraft | undefined;
  readonly problem: string | undefined;
  readonly busy: boolean;
  readonly onKind: (kind: ApplicationMaterialKind) => void;
  readonly onDraft: () => void;
  readonly onDownload: () => void;
}

const kinds = Object.keys(applicationMaterialKindLabels) as ApplicationMaterialKind[];

export function ApplicationMaterialView(props: ApplicationMaterialViewProps) {
  const { kind, draft, problem, busy } = props;
  return (
    <section className="panel host-panel application-material" aria-labelledby="material-heading">
      <h2 id="material-heading">Prepare</h2>
      <fieldset disabled={busy}>
        <legend>Draft for this application</legend>
        {kinds.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="application-material-kind"
              value={option}
              checked={kind === option}
              onChange={() => props.onKind(option)}
            />
            {applicationMaterialKindLabels[option]}
          </label>
        ))}
      </fieldset>
      {draft === undefined ? <p className="muted">{applicationMaterialDisclosure}</p> : null}
      <button type="button" className="button" disabled={busy} onClick={props.onDraft}>
        {busy ? "Drafting…" : draft === undefined ? "Draft" : "Draft again"}
      </button>
      {problem === undefined ? null : <p role="alert">{problem}</p>}
      {draft === undefined ? null : (
        <>
          <ol className="material-items">
            {draft.items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a draft's items have no id and never reorder.
              <li key={index} className="material-item">
                <div>
                  {item.question === "" ? null : <h3>{item.question}</h3>}
                  <p>{item.text}</p>
                </div>
                <aside aria-label="Sources">
                  <ul>
                    {item.citations.map((citation) => (
                      <li key={citation.fact_id}>{citation.text}</li>
                    ))}
                  </ul>
                </aside>
              </li>
            ))}
          </ol>
          <p className="muted">
            Drafted by {draft.model.model}. Check every sentence against its sources before you use
            it.
          </p>
          <button type="button" className="button" onClick={props.onDownload}>
            Download Markdown
          </button>
        </>
      )}
    </section>
  );
}

export interface ApplicationMaterialSectionProps {
  readonly client: ApiClient;
  readonly applicationId: string;
}

export function ApplicationMaterialSection({
  client,
  applicationId,
}: ApplicationMaterialSectionProps) {
  const workspaceId = useRecordId();
  const [kind, setKind] = useState<ApplicationMaterialKind>("cover-letter");
  const [draft, setDraft] = useState<ApplicationMaterialDraft | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  return (
    <ApplicationMaterialView
      kind={kind}
      draft={draft}
      problem={problem}
      busy={busy}
      onKind={(next) => {
        setKind(next);
        setDraft(undefined);
        setProblem(undefined);
      }}
      onDraft={async () => {
        setBusy(true);
        setProblem(undefined);
        try {
          setDraft(
            await client.call(
              "POST /v1/workspaces/{workspaceId}/applications/{applicationId}/material",
              { path: { workspaceId, applicationId }, body: { kind } },
            ),
          );
        } catch (error) {
          setProblem(applicationMaterialProblem(error));
        } finally {
          setBusy(false);
        }
      }}
      onDownload={() => {
        if (draft === undefined) return;
        saveFile(
          new Blob([applicationMaterialMarkdown(draft)], { type: "text/markdown" }),
          applicationMaterialFileName(draft.kind),
        );
      }}
    />
  );
}
