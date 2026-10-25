/**
 * The Export area's template hook and schematic preview (#1330); the template data and the
 * remembered-choice storage live in `export-template.ts`.
 */

import {
  type ExportTemplate,
  readStoredExportTemplate,
  writeStoredExportTemplate,
} from "@draft-loop/ui/export-template";
import { type JSX, useCallback, useState } from "react";

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The template for this application, re-read when the application changes. */
export function useExportTemplate(
  applicationKey: string,
): readonly [ExportTemplate, (next: ExportTemplate) => void] {
  const [stored, setStored] = useState(() => ({
    key: applicationKey,
    template: readStoredExportTemplate(browserStorage(), applicationKey),
  }));
  const current =
    stored.key === applicationKey
      ? stored
      : {
          key: applicationKey,
          template: readStoredExportTemplate(browserStorage(), applicationKey),
        };
  if (current !== stored) setStored(current);

  const choose = useCallback(
    (next: ExportTemplate) => {
      setStored({ key: applicationKey, template: next });
      writeStoredExportTemplate(browserStorage(), applicationKey, next);
    },
    [applicationKey],
  );

  return [current.template, choose] as const;
}

/**
 * A schematic thumbnail of the template: the name's alignment, ruled headings and text density.
 * It is decorative; the label and description carry the meaning for assistive technology.
 */
export function ExportTemplatePreview({
  template,
}: {
  readonly template: ExportTemplate;
}): JSX.Element {
  const lines = (
    template === "compact" ? ["a", "b", "c", "d", "e", "f"] : ["a", "b", "c", "d", "e"]
  ).map((line) => <span className="export-template-preview-line" key={line} />);
  return (
    <span
      className={`export-template-preview export-template-preview-${template}`}
      aria-hidden="true"
    >
      <span className="export-template-preview-name" />
      {["first", "second"].map((section) => (
        <span className="export-template-preview-section" key={section}>
          <span className="export-template-preview-heading" />
          {lines}
        </span>
      ))}
    </span>
  );
}
