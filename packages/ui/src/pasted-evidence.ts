import { t } from "@lingui/core/macro";

/**
 * Career evidence typed or pasted on screen (#2417). The host stores it as a plain-text source
 * file in the base in use, so it is screened, quarantined and deduplicated like any upload.
 */

/** The longest pasted text taken: a long CV is about 30,000 characters. */
export const pastedTextMaxLength = 200_000;

/** The longest title kept; the host adds `.txt` to make the source's file name. */
export const pastedTitleMaxLength = 120;

/** Text the host accepts: something besides blanks, within the limit, with no NUL character. */
export function isPastedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= pastedTextMaxLength &&
    !value.includes("\u0000")
  );
}

/** Why the pasted text cannot be saved yet, or undefined when it can. */
export function pastedTextProblem(text: string): string | undefined {
  if (text.trim() === "") return t`Paste or type some text first.`;
  if (text.length > pastedTextMaxLength) {
    const limit = pastedTextMaxLength.toLocaleString();
    return t`The text is too long. Keep it under ${limit} characters, or add it as a file.`;
  }
  return undefined;
}

/**
 * The title a pasted source is saved under: the person's title made safe for a file name, else
 * "Pasted text" with the date and time so two pastes on one day stay apart.
 */
export function pastedSourceTitle(title: string, now: Date): string {
  const safe = [...title]
    .map((character) =>
      character < " " || character === "\u007f" || '/\\:*?"<>|'.includes(character)
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, pastedTitleMaxLength)
    .trim();
  if (safe !== "") return safe;
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return t`Pasted text ${stamp}`;
}
