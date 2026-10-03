/** Path-free contracts for the renderer's recent-workspace controls. */
export const maximumRecentWorkspaces = 10;
export const maximumRecentWorkspaceIdLength = 64;
export const maximumRecentWorkspaceNameLength = 120;

export interface RecentWorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly lastOpenedAt: string;
}

export interface RecentWorkspacesListInput {
  readonly [key: string]: never;
}

export interface RecentWorkspaceOpenInput {
  readonly id: string;
}

export interface RecentWorkspacesClearInput {
  readonly [key: string]: never;
}

export interface RecentWorkspacesListResult {
  readonly workspaces: readonly RecentWorkspaceSummary[];
}

export interface RecentWorkspacesClearResult {
  readonly cleared: true;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid recent workspace data.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasUnsafeNameCharacters(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  );
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 32) throw new Error("Invalid timestamp.");
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error("Invalid timestamp.");
  }
  return value;
}

function safeName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumRecentWorkspaceNameLength ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    hasUnsafeNameCharacters(value)
  ) {
    throw new Error("Invalid workspace name.");
  }
  return value;
}

function safeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > maximumRecentWorkspaceIdLength ||
    !/^[A-Za-z0-9-]{16,64}$/u.test(value)
  ) {
    throw new Error("Invalid recent workspace id.");
  }
  return value;
}

function emptyInput(value: unknown): Record<string, unknown> {
  const input = record(value);
  if (Object.keys(input).length !== 0) throw new Error("Invalid recent workspace input.");
  return input;
}

export function parseRecentWorkspacesListInput(value: unknown): RecentWorkspacesListInput {
  emptyInput(value);
  return {};
}

export function parseRecentWorkspacesClearInput(value: unknown): RecentWorkspacesClearInput {
  emptyInput(value);
  return {};
}

export function parseRecentWorkspaceOpenInput(value: unknown): RecentWorkspaceOpenInput {
  const input = record(value);
  if (!exactKeys(input, ["id"])) throw new Error("Invalid recent workspace input.");
  return { id: safeId(input.id) };
}

export function parseRecentWorkspacesListResult(value: unknown): RecentWorkspacesListResult {
  const result = record(value);
  if (!exactKeys(result, ["workspaces"]) || !Array.isArray(result.workspaces)) {
    throw new Error("Invalid recent workspace result.");
  }
  if (result.workspaces.length > maximumRecentWorkspaces) {
    throw new Error("Invalid recent workspace result.");
  }
  const workspaces = result.workspaces.map((candidate) => {
    const item = record(candidate);
    if (!exactKeys(item, ["id", "name", "lastOpenedAt"])) {
      throw new Error("Invalid recent workspace result.");
    }
    return {
      id: safeId(item.id),
      name: safeName(item.name),
      lastOpenedAt: isoTimestamp(item.lastOpenedAt),
    };
  });
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length) {
    throw new Error("Invalid recent workspace result.");
  }
  return { workspaces };
}

export function parseRecentWorkspacesClearResult(value: unknown): RecentWorkspacesClearResult {
  const result = record(value);
  if (!exactKeys(result, ["cleared"]) || result.cleared !== true) {
    throw new Error("Invalid recent workspace result.");
  }
  return { cleared: true };
}
