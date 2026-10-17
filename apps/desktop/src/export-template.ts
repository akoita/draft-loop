/**
 * Export template choice (#1330).
 *
 * The Export area offers the built-in rendering templates with a small schematic preview. The
 * choice is remembered per application in `localStorage`: it is a preference about how this
 * application's CV should look, so a new run of the same application opens on it, while another
 * application keeps its own. An application is keyed by its first run, which never changes; a run
 * outside an application is its own key. Nothing is stored until the person picks a template.
 *
 * The ids mirror the rendering package's built-ins; a test keeps the two lists equal, so a new
 * built-in (such as Modern, #1329) must be added here to appear in the picker.
 */
export const exportTemplates = ["classic", "compact", "modern"] as const;
export type ExportTemplate = (typeof exportTemplates)[number];

export const defaultExportTemplate: ExportTemplate = "classic";

export const exportTemplateLabels: Readonly<Record<ExportTemplate, string>> = {
  classic: "Classic",
  compact: "Compact",
  modern: "Modern",
};

/** One line on what the template is for, shown beside the preview. */
export const exportTemplateDescriptions: Readonly<Record<ExportTemplate, string>> = {
  classic: "Two pages, centred name, ruled headings and room for full role histories.",
  compact: "One page with smaller type and tighter spacing, so the most fits on each page.",
  modern: "Two pages, left-aligned name, teal headings and dates, justified text.",
};

/** `localStorage` key prefix; the application key follows it. */
export const exportTemplateStorageKeyPrefix = "draft-loop.export.template.";

/**
 * The key an application's choice is stored under: its workspace and its first run. The runs list
 * is newest first, so the first run is the last row; without an application the run stands alone.
 */
export function exportTemplateApplicationKey(state: {
  readonly workspaceId: string;
  readonly runId: string;
  readonly applicationRuns?: readonly { readonly runId: string }[] | null;
}): string {
  const firstRun = state.applicationRuns?.at(-1)?.runId ?? state.runId;
  return `${exportTemplateStorageKeyPrefix}${state.workspaceId}:${firstRun}`;
}

export function parseExportTemplate(raw: string | null): ExportTemplate {
  return exportTemplates.find((template) => template === raw) ?? defaultExportTemplate;
}

/** Read a stored choice; a blocked store reads as no choice, never as a failure. */
export function readStoredExportTemplate(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): ExportTemplate {
  if (storage === undefined) return defaultExportTemplate;
  try {
    return parseExportTemplate(storage.getItem(key));
  } catch {
    return defaultExportTemplate;
  }
}

/** Persist a choice, ignoring quota and security failures. */
export function writeStoredExportTemplate(
  storage: Pick<Storage, "setItem"> | undefined,
  key: string,
  template: ExportTemplate,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(key, template);
  } catch {
    // A blocked or full store costs the person the remembered choice, not the export.
  }
}
