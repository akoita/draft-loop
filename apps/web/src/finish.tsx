import { useState } from "react";

import {
  approvalNeedsRationale,
  canExport,
  defaultExportFormat,
  defaultTemplateId,
  type ExportFormat,
  exportFormats,
  exportTemplates,
  type RunExport,
} from "./finish-model.js";
import { type RunReview, reviewOpen } from "./review-model.js";
import { formatBytes } from "./sources-model.js";

export interface FinishPanelProps {
  readonly review: RunReview;
  readonly exports: readonly RunExport[];
  readonly busy: boolean;
  readonly onApprove: (rationale: string) => void;
  readonly onRevise: (direction: string) => void;
  readonly onExport: (format: ExportFormat, templateId: string) => void;
  readonly onDownload: (exported: RunExport) => void;
}

/** Approve the draft or ask for another round, then export and download the CV. */
export function FinishPanel(props: FinishPanelProps) {
  const { review, busy } = props;
  const [rationale, setRationale] = useState("");
  const [direction, setDirection] = useState("");
  const [format, setFormat] = useState<ExportFormat>(defaultExportFormat);
  const [templateId, setTemplateId] = useState(defaultTemplateId);

  if (reviewOpen(review)) {
    const needsReason = approvalNeedsRationale(review);
    return (
      <section className="panel">
        <h2>Approve or revise</h2>
        <label htmlFor="approve-rationale">
          {needsReason
            ? "Why approve with the open checks (required)"
            : "Note for the record (optional)"}
        </label>
        <input
          id="approve-rationale"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => props.onApprove(rationale)}>
            Approve this draft
          </button>
        </div>
        <label htmlFor="revision-direction">Direction for another round (optional)</label>
        <textarea
          id="revision-direction"
          className="short"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        />
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => props.onRevise(direction)}
          >
            Ask for another round
          </button>
        </div>
        <p className="muted">
          Another round revises the draft with your decisions; the Run step follows it.
        </p>
      </section>
    );
  }

  if (!canExport(review)) return null;

  return (
    <section className="panel">
      <h2>Export</h2>
      <div className="pair">
        <div>
          <label htmlFor="export-format">Format</label>
          <select
            id="export-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            {exportFormats.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="export-template">Template</label>
          <select
            id="export-template"
            value={templateId}
            disabled={format === "markdown"}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {exportTemplates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => props.onExport(format, templateId)}>
          Export
        </button>
      </div>
      {props.exports.length === 0 ? (
        <p className="muted">No export yet.</p>
      ) : (
        <ul className="exports">
          {props.exports.map((exported) => (
            <li key={exported.id}>
              {exported.format.toUpperCase()}
              {exported.templateId === undefined ? "" : ` · ${exported.templateId}`} ·{" "}
              {formatBytes(exported.sizeBytes)} ·{" "}
              {exported.createdAt.slice(0, 16).replace("T", " ")} UTC{" "}
              <button
                type="button"
                className="secondary small"
                onClick={() => props.onDownload(exported)}
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
