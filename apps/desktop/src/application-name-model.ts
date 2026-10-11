/** Renaming applications: the messages and when the default application asks for a name. */

export const invalidApplicationNameMessage = "Enter a name of 1 to 120 characters.";
export const applicationRenameFailureMessage = "The application could not be renamed.";

/** True while the default application still has the name DraftLoop derived for it. */
export function needsApplicationName(application: {
  readonly isDefault: boolean;
  readonly nameChosen: boolean;
  readonly archivedAt: string | null;
}): boolean {
  return application.isDefault && !application.nameChosen && application.archivedAt === null;
}
