import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type RenderPdfPages, renderPdfPages } from "./export-preview-pdf.js";
import {
  type ExportTemplate,
  exportTemplateLabels,
  exportTemplatePageTargets,
  exportTemplates,
} from "./export-template.js";
import { type ExportFormat, exportFormatLabels, exportFormats } from "./model.js";
import { useModalFocusTrap } from "./review.js";

/** What a preview shows: one run's export in a format and template. */
export interface ExportPreviewRequest {
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  readonly template: ExportTemplate;
}

/** Reads the document an export of these choices would save, without saving it (#2497). */
export type LoadExportPreview = (request: ExportPreviewRequest) => Promise<Blob>;

export interface ExportPreviewDialogProps {
  readonly workspaceId: string;
  readonly runId: string;
  readonly format: ExportFormat;
  readonly template: ExportTemplate;
  readonly onFormatChange: (format: ExportFormat) => void;
  readonly onTemplateChange: (template: ExportTemplate) => void;
  readonly load: LoadExportPreview;
  /** Exports what the preview shows; disabled while another action is pending. */
  readonly onExport: () => void;
  readonly exportDisabled: boolean;
  readonly onClose: () => void;
  /** Draws a PDF's pages; tests pass their own, since pdf.js needs a real browser. */
  readonly renderPdf?: RenderPdfPages;
}

type PreviewView =
  | { readonly kind: "loading" }
  | { readonly kind: "pages"; readonly pageCount: number }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

export const exportPreviewFailure = () =>
  t`The preview could not be drawn. Nothing was saved; you can still export.`;

/** What a preview reads: a browser has no Word viewer, so Word shows the template's PDF pages. */
export function previewedFormat(format: ExportFormat): Exclude<ExportFormat, "docx"> {
  return format === "docx" ? "pdf" : format;
}

/** Shown over a Word preview, which draws the same template's PDF pages. */
export const wordPreviewNote = () =>
  t`These are the template's pages as a PDF. Word lays out the same text, but its line breaks can differ slightly.`;

const pageLabel = (page: number, pageCount: number) => t`Page ${page} of ${pageCount}`;

/** "2 pages · Modern aims for 2", so the person sees whether the CV fits its template. */
export function previewPageFit(pageCount: number, template: ExportTemplate) {
  const target = exportTemplatePageTargets[template];
  const pages = plural(pageCount, { one: "# page", other: "# pages" });
  const name = exportTemplateLabels()[template];
  return {
    text: t`${pages} · ${name} aims for ${target}`,
    over: pageCount > target,
  };
}

/**
 * The export preview (#2498): the file Export would save, drawn page by page, with the template
 * and format switch beside it. Nothing is saved until the person exports.
 */
export function ExportPreviewDialog({
  workspaceId,
  runId,
  format,
  template,
  onFormatChange,
  onTemplateChange,
  load,
  onExport,
  exportDisabled,
  onClose,
  renderPdf = renderPdfPages,
}: ExportPreviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<PreviewView>({ kind: "loading" });
  const close = useCallback(() => onClose(), [onClose]);
  useModalFocusTrap(true, dialogRef, close);

  useEffect(() => {
    const signal = { cancelled: false };
    setView({ kind: "loading" });
    const show = async (): Promise<PreviewView> => {
      const blob = await load({
        workspaceId,
        runId,
        format: previewedFormat(format),
        template,
      });
      if (format === "markdown") return { kind: "text", text: await blob.text() };
      const container = pagesRef.current;
      if (container === null) return { kind: "loading" };
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const pageCount = await renderPdf(bytes, container, signal, pageLabel);
      return { kind: "pages", pageCount };
    };
    show()
      .then((shown) => {
        if (!signal.cancelled) setView(shown);
      })
      .catch((error: unknown) => {
        if (signal.cancelled) return;
        const message =
          error instanceof Error && error.message !== "" ? error.message : exportPreviewFailure();
        setView({ kind: "error", message });
      });
    return () => {
      signal.cancelled = true;
    };
  }, [workspaceId, runId, format, template, load, renderPdf]);

  const fit = view.kind === "pages" ? previewPageFit(view.pageCount, template) : null;

  const dialog = (
    <div className="modal-backdrop export-preview-backdrop">
      <div
        className="export-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        ref={dialogRef}
      >
        <header className="export-preview-header">
          <h2 id="export-preview-title">{t`Preview`}</h2>
          <button
            className="button button-quiet export-preview-close"
            type="button"
            aria-label={t`Close the preview`}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="export-preview-tools">
          <fieldset className="export-preview-templates">
            <legend className="sr-only">{t`Template`}</legend>
            {exportTemplates.map((choice) => (
              <label
                className={`export-preview-template${choice === template ? " is-chosen" : ""}`}
                key={choice}
              >
                <input
                  type="radio"
                  name="export-preview-template"
                  value={choice}
                  checked={choice === template}
                  onChange={() => onTemplateChange(choice)}
                />
                {exportTemplateLabels()[choice]}
              </label>
            ))}
          </fieldset>
          <select
            className="export-preview-format"
            value={format}
            aria-label={t`Export format`}
            onChange={(event) => {
              const chosen = exportFormats.find((option) => option === event.target.value);
              if (chosen !== undefined) onFormatChange(chosen);
            }}
          >
            {exportFormats.map((option) => (
              <option key={option} value={option}>
                {exportFormatLabels[option]}
              </option>
            ))}
          </select>
          {fit === null ? null : (
            <span className={`export-preview-fit${fit.over ? " is-over" : ""}`} role="status">
              {fit.text}
            </span>
          )}
        </div>
        <div className="export-preview-canvas" aria-busy={view.kind === "loading"}>
          {view.kind === "loading" ? (
            <p className="export-preview-message" role="status">
              {t`Drawing the preview…`}
            </p>
          ) : null}
          {view.kind === "error" ? (
            <p className="export-preview-message" role="alert">
              {view.message}
            </p>
          ) : null}
          {format === "docx" && view.kind === "pages" ? (
            <p className="export-preview-message" role="note">
              {wordPreviewNote()}
            </p>
          ) : null}
          {view.kind === "text" ? <pre className="export-preview-text">{view.text}</pre> : null}
          <div
            className="export-preview-pages"
            ref={pagesRef}
            hidden={format === "markdown" || view.kind === "error"}
          />
        </div>
        <footer className="export-preview-footer">
          <p className="export-preview-note">{t`Nothing is saved until you export.`}</p>
          <div className="export-preview-actions">
            <button className="button button-quiet" type="button" onClick={close}>
              {t`Close`}
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={exportDisabled}
              onClick={onExport}
            >
              {t`Export this file…`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
