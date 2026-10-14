/**
 * The job requirement a review finding is about, as the renderer reads it.
 *
 * Coverage findings carry only a requirement id. The host resolves the id to
 * the run's requirement text, so a person can tell which requirement each
 * finding means. Findings whose requirement cannot be resolved omit the field.
 */

export interface FindingRequirement {
  readonly id: string;
  /** The requirement text on one line, at most `maximumFindingRequirementTextLength`. */
  readonly text: string;
}

function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export const findingRequirementKeys = exactKeys<FindingRequirement>()(["id", "text"]);

export const maximumFindingRequirementIdLength = 200;
export const maximumFindingRequirementTextLength = 300;

/**
 * The requirement the host attaches to a finding: its text with line breaks
 * collapsed and bounded, or `undefined` without an id or a known text.
 */
export function findingRequirement(
  requirementId: string | undefined,
  requirementTexts: ReadonlyMap<string, string> | undefined,
): FindingRequirement | undefined {
  if (
    requirementId === undefined ||
    requirementId.length === 0 ||
    requirementId.length > maximumFindingRequirementIdLength
  ) {
    return undefined;
  }
  const text = requirementTexts?.get(requirementId);
  if (text === undefined) return undefined;
  const oneLine = text
    .replace(/\s*[\r\n\u2028\u2029]+\s*/gu, " ")
    .trim()
    .slice(0, maximumFindingRequirementTextLength);
  return oneLine === "" ? undefined : { id: requirementId, text: oneLine };
}

/** The requirement with only its known fields, or `undefined` when the value does not have its shape. */
export function normalizeFindingRequirement(value: unknown): FindingRequirement | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    !Object.keys(raw).every((key) => (findingRequirementKeys as readonly string[]).includes(key))
  ) {
    return undefined;
  }
  const { id, text } = raw;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > maximumFindingRequirementIdLength ||
    typeof text !== "string" ||
    text.length > maximumFindingRequirementTextLength
  ) {
    return undefined;
  }
  return { id, text };
}
