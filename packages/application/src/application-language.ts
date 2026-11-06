/**
 * The document language each application writes in (#2315), kept as the
 * `application-languages.json` workspace setting: a file under `.draft-loop/` locally, a
 * `workspace_settings` row on the server. An application without an entry writes in the
 * workspace's language, so nothing changes until the person picks one.
 */
import { defaultApplicationId } from "@draft-loop/domain/application";
import {
  type ApplicationLanguages,
  applicationLanguagesSchema,
  applicationLanguagesSchemaVersion,
  documentLanguageCodeSchema,
} from "@draft-loop/schemas/application-language";
import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { CliUserError } from "./cli-user-error.js";
import { workspaceSettings } from "./workspace-settings.js";

const applicationLanguagesSetting = "application-languages.json";

const emptyApplicationLanguages: ApplicationLanguages = {
  schemaVersion: applicationLanguagesSchemaVersion,
  languages: {},
};

export async function readApplicationLanguages(
  root: string,
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<ApplicationLanguages> {
  const text = await settings.read(root, applicationLanguagesSetting);
  if (text === undefined) return emptyApplicationLanguages;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliUserError("The application language setting is invalid.");
  }
  const result = applicationLanguagesSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError("The application language setting is invalid.");
  return result.data;
}

/** The language an application chose, or null when it writes in the workspace's language. */
export function applicationLanguage(
  languages: ApplicationLanguages,
  applicationId: string,
): string | null {
  return Object.hasOwn(languages.languages, applicationId)
    ? (languages.languages[applicationId] ?? null)
    : null;
}

/**
 * Sets a created application's language, or clears it with `null`; resolves with the new
 * setting. The default application writes in the workspace's language.
 */
export async function setApplicationLanguage(
  root: string,
  applicationId: string,
  language: string | null,
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<ApplicationLanguages> {
  if (applicationId === defaultApplicationId) {
    throw new CliUserError(
      "The default application writes in the workspace's language. Change the workspace's language instead.",
    );
  }
  if (language !== null && !documentLanguageCodeSchema.safeParse(language).success) {
    throw new CliUserError(`${language} is not a language DraftLoop can write documents in.`);
  }
  const current = await readApplicationLanguages(root, settings);
  const { [applicationId]: _previous, ...others } = current.languages;
  const next: ApplicationLanguages = {
    schemaVersion: applicationLanguagesSchemaVersion,
    languages: language === null ? others : { ...others, [applicationId]: language },
  };
  const checked = applicationLanguagesSchema.safeParse(next);
  if (!checked.success) throw new CliUserError("That application language cannot be saved.");
  await settings.write(root, applicationLanguagesSetting, `${JSON.stringify(checked.data)}\n`);
  return checked.data;
}

/** The workspace configuration with the application's own language, when it chose one. */
export function withApplicationLanguage<Config extends { readonly language: string }>(
  config: Config,
  language: string | null,
): Config {
  return language === null ? config : { ...config, language };
}
