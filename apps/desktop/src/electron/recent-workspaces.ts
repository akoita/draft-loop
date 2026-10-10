import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize, resolve } from "node:path";
import {
  maximumRecentWorkspaceIdLength,
  maximumRecentWorkspaceNameLength,
  maximumRecentWorkspaces,
  type RecentWorkspaceSummary,
} from "../recent-workspaces.js";
import { normalizeWorkspaceDisplayName } from "../workspace-name.js";

const maximumStoreBytes = 64 * 1024;
const maximumStoredPathLength = 4_096;

interface StoredRecentWorkspace extends RecentWorkspaceSummary {
  readonly path: string;
}

interface TextPersistence {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface RecentWorkspaceStore {
  list(): Promise<readonly RecentWorkspaceSummary[]>;
  resolvePath(id: string): Promise<string | undefined>;
  remember(name: string, path: string, openedAt?: string): Promise<RecentWorkspaceSummary>;
  /** Renames the entry for a path, keeping its place in the list. Unknown paths are ignored. */
  rename(path: string, name: string): Promise<void>;
  /** Forgets one entry. Workspace files are never touched; unknown ids are ignored. */
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

function pathIdentity(path: string, platform: NodeJS.Platform): string {
  const canonical = normalize(resolve(path));
  return platform === "win32" ? canonical.toLocaleLowerCase("en-US") : canonical;
}

function safeDisplayName(value: string, path: string): string {
  const candidate = value.replaceAll("\\", "/");
  const primaryCandidate = basename(candidate);
  if (primaryCandidate === "." || primaryCandidate === "..") return "Workspace";
  const clean = (name: string) =>
    [...name]
      .map((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 || code === 127 ? " " : character;
      })
      .join("")
      .trim()
      .slice(0, maximumRecentWorkspaceNameLength)
      .trim();
  const valid = (name: string) => {
    const result = clean(name);
    return result !== "." && result !== ".." && !hasUnsafeNameCharacters(result) ? result : "";
  };
  const primary = valid(primaryCandidate);
  const fallback = valid(basename(path));
  return primary !== "" ? primary : fallback !== "" ? fallback : "Workspace";
}

/**
 * Marks entries whose name collides with another entry's by adding the name of
 * their containing folder. Only that one folder name leaves the store.
 */
function summaries(entries: readonly StoredRecentWorkspace[]): RecentWorkspaceSummary[] {
  const counts = new Map<string, number>();
  for (const { name } of entries) {
    const key = name.toLocaleLowerCase("en-US");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map(({ id, name, path, lastOpenedAt }) => {
    const summary = { id, name, lastOpenedAt };
    if ((counts.get(name.toLocaleLowerCase("en-US")) ?? 0) < 2) return summary;
    const location = basename(dirname(path)).slice(0, maximumRecentWorkspaceNameLength).trim();
    return location === "" ||
      location === "." ||
      location === ".." ||
      hasUnsafeNameCharacters(location)
      ? summary
      : { ...summary, location };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
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

function parseStore(value: string | null, platform: NodeJS.Platform): StoredRecentWorkspace[] {
  if (value === null || Buffer.byteLength(value, "utf8") > maximumStoreBytes) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: StoredRecentWorkspace[] = [];
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const candidate of parsed.slice(0, maximumRecentWorkspaces * 4)) {
    if (!isRecord(candidate)) continue;
    const { id, name, path, lastOpenedAt } = candidate;
    if (
      typeof id !== "string" ||
      id.length > maximumRecentWorkspaceIdLength ||
      !/^[A-Za-z0-9-]{16,64}$/u.test(id) ||
      ids.has(id) ||
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > maximumRecentWorkspaceNameLength ||
      name.trim() !== name ||
      name === "." ||
      name === ".." ||
      hasUnsafeNameCharacters(name) ||
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > maximumStoredPathLength ||
      !isAbsolute(path) ||
      !validTimestamp(lastOpenedAt)
    ) {
      continue;
    }
    const pathKey = pathIdentity(path, platform);
    if (paths.has(pathKey)) continue;
    paths.add(pathKey);
    ids.add(id);
    entries.push({ id, name, path: resolve(path), lastOpenedAt });
    if (entries.length === maximumRecentWorkspaces) break;
  }
  return entries;
}

function store(persistence: TextPersistence, platform: NodeJS.Platform): RecentWorkspaceStore {
  let loaded: StoredRecentWorkspace[] | undefined;
  let queue: Promise<void> = Promise.resolve();

  const readEntries = async () => {
    if (loaded !== undefined) return loaded;
    const raw = await persistence.read().catch(() => null);
    loaded = parseStore(raw, platform);
    return loaded;
  };
  const serialize = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const persist = async (entries: readonly StoredRecentWorkspace[]) => {
    await persistence.write(JSON.stringify(entries));
    loaded = [...entries];
  };

  return {
    list: () => serialize(async () => summaries(await readEntries())),
    rename: (path, name) =>
      serialize(async () => {
        if (normalizeWorkspaceDisplayName(name) !== name) {
          throw new Error("Invalid recent workspace record.");
        }
        const entries = await readEntries();
        const key = pathIdentity(path, platform);
        const target = entries.find((entry) => pathIdentity(entry.path, platform) === key);
        if (target === undefined || target.name === name) return;
        await persist(entries.map((entry) => (entry === target ? { ...entry, name } : entry)));
      }),
    resolvePath: (id) =>
      serialize(async () => (await readEntries()).find((entry) => entry.id === id)?.path),
    remember: (name, path, openedAt = new Date().toISOString()) =>
      serialize(async () => {
        const entries = await readEntries();
        const normalizedPath = resolve(path);
        if (
          normalizedPath.length > maximumStoredPathLength ||
          !isAbsolute(normalizedPath) ||
          !validTimestamp(openedAt)
        ) {
          throw new Error("Invalid recent workspace record.");
        }
        const key = pathIdentity(normalizedPath, platform);
        const previous = entries.find((entry) => pathIdentity(entry.path, platform) === key);
        const entry: StoredRecentWorkspace = {
          id: previous?.id ?? randomUUID(),
          name: safeDisplayName(name, normalizedPath),
          path: normalizedPath,
          lastOpenedAt: openedAt,
        };
        await persist(
          [
            entry,
            ...entries.filter(
              (item) => item.id !== previous?.id && pathIdentity(item.path, platform) !== key,
            ),
          ].slice(0, maximumRecentWorkspaces),
        );
        return { id: entry.id, name: entry.name, lastOpenedAt: entry.lastOpenedAt };
      }),
    remove: (id) =>
      serialize(async () => {
        const entries = await readEntries();
        if (!entries.some((entry) => entry.id === id)) return;
        await persist(entries.filter((entry) => entry.id !== id));
      }),
    clear: () => serialize(async () => persist([])),
  };
}

export function createRecentWorkspaceStore(
  options: { readonly filename?: string; readonly platform?: NodeJS.Platform } = {},
): RecentWorkspaceStore {
  const platform = options.platform ?? process.platform;
  if (options.filename === undefined) {
    let content = "[]";
    return store(
      {
        read: async () => content,
        write: async (value) => {
          content = value;
        },
      },
      platform,
    );
  }

  const filename = resolve(options.filename);
  return store(
    {
      read: async () => {
        try {
          const file = await stat(filename);
          if (file.size > maximumStoreBytes) return null;
          return await readFile(filename, "utf8");
        } catch {
          return null;
        }
      },
      write: async (value) => {
        if (Buffer.byteLength(value, "utf8") > maximumStoreBytes) {
          throw new Error("Recent workspace store exceeded its size limit.");
        }
        await mkdir(dirname(filename), { recursive: true });
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
          await rename(temporary, filename);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }
      },
    },
    platform,
  );
}
