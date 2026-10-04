/** Pure display helpers that turn canonical profile keys into readable review text. */

const issueCodeLabels: Readonly<Record<string, string>> = {
  "conflict-date": "Conflicting dates",
  "conflict-title": "Conflicting titles",
  "conflict-duration": "Conflicting durations",
  "conflict-metric": "Conflicting metrics",
  "conflict-value": "Conflicting values",
  duplicate: "Possible duplicate",
  omission: "Omission",
};

const acronymPattern = /^[A-Z]{2,}$/u;

function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/[_\-\s]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      if (acronymPattern.test(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(" ");
}

/** "skillName" -> "Skill name"; keeps acronyms such as URL and GPA uppercase. */
export function humanizeProfileFieldLabel(field: string): string {
  return humanizeKey(field);
}

/** "approved-link" -> "Approved link". */
export function humanizeProfileCategory(category: string): string {
  return humanizeKey(category);
}

export function profileIssueCodeLabel(code: string): string {
  return issueCodeLabels[code] ?? humanizeKey(code);
}

export function sourceCountLabel(count: number): string {
  return count === 1 ? "1 source" : `${count} sources`;
}

/** Shorten a value for inline display, appending an ellipsis when it is cut. */
export function truncateProfileText(value: string, maximumLength = 60): string {
  const characters = [...value];
  if (characters.length <= maximumLength) return value;
  return `${characters
    .slice(0, maximumLength - 1)
    .join("")
    .trimEnd()}…`;
}
