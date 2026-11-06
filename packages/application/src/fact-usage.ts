/**
 * The workspace's fact usage levels (#2258), kept as the `fact-usage.json` workspace setting: a
 * file under `.draft-loop/` locally, a `workspace_settings` row on the server. Like every setting
 * it goes into the record archive and is deleted with the workspace. It holds levels by section
 * and by fact usage key, never fact text.
 */
import {
  emptyFactUsageSettings,
  type FactUsageSettings,
  withFactUsage,
} from "@draft-loop/domain/fact-usage";
import { type FactUsageChange, factUsageSettingsSchema } from "@draft-loop/schemas/fact-usage";
import type { WorkspaceSettingsPort } from "@draft-loop/storage";
import { CliUserError } from "./cli-user-error.js";
import { workspaceSettings } from "./workspace-settings.js";

const factUsageSetting = "fact-usage.json";

export async function readFactUsage(
  root: string,
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<FactUsageSettings> {
  const text = await settings.read(root, factUsageSetting);
  if (text === undefined) return emptyFactUsageSettings;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliUserError("The fact usage setting is invalid.");
  }
  const result = factUsageSettingsSchema.safeParse(parsed);
  if (!result.success) throw new CliUserError("The fact usage setting is invalid.");
  return result.data as FactUsageSettings;
}

/** Applies one change and writes the whole setting; resolves with the new settings. */
export async function changeFactUsage(
  root: string,
  change: FactUsageChange,
  settings: WorkspaceSettingsPort = workspaceSettings(),
): Promise<FactUsageSettings> {
  const current = await readFactUsage(root, settings);
  const target =
    change.kind === "section"
      ? ({ kind: "section", category: change.category } as const)
      : ({ kind: "fact", key: change.key } as const);
  const next = withFactUsage(current, target, change.level ?? undefined);
  const checked = factUsageSettingsSchema.safeParse(next);
  if (!checked.success) throw new CliUserError("That usage level cannot be saved.");
  await settings.write(root, factUsageSetting, `${JSON.stringify(checked.data)}\n`);
  return checked.data as FactUsageSettings;
}

/** The usage levels of a driver's workspaces, over its settings port. */
export interface FactUsageService {
  readonly read: (root: string) => Promise<FactUsageSettings>;
  readonly change: (root: string, change: FactUsageChange) => Promise<FactUsageSettings>;
}

export function createFactUsageService(settings?: WorkspaceSettingsPort): FactUsageService {
  const port = () => settings ?? workspaceSettings();
  return {
    read: (root) => readFactUsage(root, port()),
    change: (root, change) => changeFactUsage(root, change, port()),
  };
}

export {
  type FactUsageLevel,
  type FactUsageSettings,
  factUsageKey,
  filterFactsForUsage,
  resolveFactUsage,
} from "@draft-loop/domain/fact-usage";
