import { applicationNameMaxLength } from "@draft-loop/domain/application";

/** The first Markdown heading of a job text, trimmed to the name limit; undefined without one. */
export function jobHeading(jobText: string | undefined): string | undefined {
  const line = jobText?.split(/\r?\n/u).find((candidate) => /^ {0,3}#{1,6}\s+\S/u.test(candidate));
  if (line === undefined) return undefined;
  const name = line
    .replace(/^[\s#]+/u, "")
    .trim()
    .slice(0, applicationNameMaxLength)
    .trim();
  return name === "" ? undefined : name;
}

/**
 * A display name for the legacy application: its first Markdown heading. A pasted web page often
 * starts with navigation text, so without a heading the name stays generic.
 */
export function defaultApplicationName(jobText: string | undefined): string {
  return jobHeading(jobText) ?? "Default application";
}

/** A name in the person's own terms, such as "Staff Engineer at Acme", from a brief's role and employer. */
export function suggestedApplicationName(
  role: string | undefined,
  employer: string | undefined,
): string | undefined {
  const parts = [role?.trim(), employer?.trim()].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  if (parts.length === 0) return undefined;
  const name = parts.join(" at ").slice(0, applicationNameMaxLength).trim();
  return name === "" ? undefined : name;
}
