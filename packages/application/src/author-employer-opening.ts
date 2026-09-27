import { excludedTitleWords, narrowOpeningActionVerbs } from "./opening-action-verbs.js";

const capitalizedEmployerWordPattern = /^\p{Lu}[\p{L}\p{N}]*$/u;

export interface ProtectedEmployerOpening {
  readonly value: string;
  readonly start: number;
}

/** Split only an opening `At <employer>, <listed lowercase action>` phrase. */
export function protectedEmployerOpening(
  text: string,
  matched: string,
  start: number,
): ProtectedEmployerOpening | undefined {
  if (text.slice(0, start).trim() !== "") return undefined;

  const employerMatch = /^At[ \t]+(?<employer>[\p{Lu}][\p{L}\p{N}]*)$/u.exec(matched);
  const employer = employerMatch?.groups?.employer;
  if (employer === undefined) return undefined;

  if (
    !capitalizedEmployerWordPattern.test(employer) ||
    excludedTitleWords.has(employer) ||
    employer === "And" ||
    employer === "Or" ||
    employer === "Of"
  ) {
    return undefined;
  }

  const action = /^,[ \t]+(?<action>\p{Ll}[\p{L}'’-]*)\b/u.exec(text.slice(start + matched.length))
    ?.groups?.action;
  if (
    action === undefined ||
    ![...narrowOpeningActionVerbs].some((verb) => verb.toLocaleLowerCase("en-US") === action)
  ) {
    return undefined;
  }

  return { value: employer, start: start + matched.indexOf(employer) };
}
