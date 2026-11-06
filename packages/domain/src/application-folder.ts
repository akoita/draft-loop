/**
 * A folder groups a workspace's applications into one named section on Home. Folders do not
 * nest, and an application sits in at most one. A folder holds nothing itself: deleting one moves
 * its applications back to "No folder" and never deletes them. An archived application keeps its
 * folder, so restoring it puts it back where it was.
 */

export const applicationFolderNameMaxLength = 60;

/** The most folders one workspace can hold, so Home's sections stay a short list. */
export const applicationFolderLimit = 50;

/** `fld_` and 8 to 64 URL-safe characters. */
export const applicationFolderIdPattern = /^fld_[A-Za-z0-9_-]{8,64}$/u;

export function isApplicationFolderId(value: string): boolean {
  return applicationFolderIdPattern.test(value);
}

/** Trimmed name of 1 to 60 characters, inner runs of spaces collapsed. */
export function normalizeApplicationFolderName(name: string): string {
  const trimmed = name.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0 || trimmed.length > applicationFolderNameMaxLength) {
    throw new RangeError(
      `Folder name must be between 1 and ${applicationFolderNameMaxLength} characters.`,
    );
  }
  return trimmed;
}

/**
 * The key two folder names collide on: case and accents are ignored, so "Fintech" and "fintech"
 * cannot both exist in one workspace.
 */
export function applicationFolderNameKey(name: string): string {
  return normalizeApplicationFolderName(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en");
}
