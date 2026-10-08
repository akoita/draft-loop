/**
 * Workspace display names, shared by the renderer, the bridge validator and
 * the native host so one rule decides what a person may call a workspace.
 */
export const maximumWorkspaceNameLength = 80;

export const invalidWorkspaceNameMessage =
  "Enter a name of 1 to 80 characters without slashes or control characters.";

const fallbackFolderName = "draft-loop-workspace";
const maximumFolderNameLength = 60;

function hasUnsafeCharacters(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    })
  );
}

/**
 * Trims a typed name and returns it when it is a valid display name.
 *
 * Spaces, accents, dashes and other punctuation are allowed. Path separators
 * and control characters are not, because the name is also shown in lists that
 * must never be mistaken for a location.
 */
export function normalizeWorkspaceDisplayName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const name = input.trim();
  if (name.length === 0 || name.length > maximumWorkspaceNameLength) return undefined;
  if (name === "." || name === "..") return undefined;
  return hasUnsafeCharacters(name) ? undefined : name;
}

/**
 * A folder name for a new workspace, derived from its display name.
 *
 * A name that is already a safe folder name is kept exactly, so tools that
 * create a workspace by folder name keep finding it. Anything else becomes
 * lowercase ASCII with dashes, falling back to `draft-loop-workspace`.
 */
export function workspaceFolderName(displayName: string): string {
  if (
    displayName.length <= maximumFolderNameLength &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/u.test(displayName)
  ) {
    return displayName;
  }
  const slug = displayName
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9._-]/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-._]+|[-._]+$/gu, "")
    .slice(0, maximumFolderNameLength)
    .replace(/[-._]+$/u, "");
  return slug === "" ? fallbackFolderName : slug;
}
