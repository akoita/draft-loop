import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseServerAddress, thisComputerOrigin } from "./server-address.js";

/** A server the client has opened before. Only its address and a name are kept. */
export interface SavedServer {
  readonly origin: string;
  readonly name: string;
}

export interface ServerList {
  readonly servers: readonly SavedServer[];
  /** The server opened at launch. */
  readonly selected?: string | undefined;
}

export const serverListFilename = "servers.json";

/** The list before anything was saved: this computer's self-hosted server. */
export const initialServerList: ServerList = {
  servers: [{ origin: thisComputerOrigin, name: "This computer" }],
  selected: thisComputerOrigin,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a saved list, dropping any entry whose address no longer passes the address rules. */
export function parseServerList(value: unknown): ServerList {
  if (!isRecord(value) || !Array.isArray(value.servers)) return initialServerList;
  const servers: SavedServer[] = [];
  for (const entry of value.servers) {
    if (!isRecord(entry) || typeof entry.origin !== "string") continue;
    const address = parseServerAddress(entry.origin);
    if (!address.ok || servers.some((server) => server.origin === address.origin)) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim() !== ""
        ? entry.name.trim()
        : address.origin;
    servers.push({ origin: address.origin, name: name.slice(0, 80) });
  }
  const selected =
    typeof value.selected === "string" && servers.some((server) => server.origin === value.selected)
      ? value.selected
      : undefined;
  return { servers, selected };
}

/** Adds or renames a server and selects it. */
export function withServer(list: ServerList, server: SavedServer): ServerList {
  const others = list.servers.filter((entry) => entry.origin !== server.origin);
  return { servers: [...others, server], selected: server.origin };
}

/** Removes a server; if it was selected, nothing is selected and the picker opens next time. */
export function withoutServer(list: ServerList, origin: string): ServerList {
  return {
    servers: list.servers.filter((entry) => entry.origin !== origin),
    selected: list.selected === origin ? undefined : list.selected,
  };
}

export interface ServerListStore {
  read(): ServerList;
  write(list: ServerList): void;
}

/** A small JSON file in the app's user-data folder; a missing or broken file reads as the initial list. */
export function createServerListStore(userDataDirectory: string): ServerListStore {
  const file = join(userDataDirectory, serverListFilename);
  return {
    read() {
      try {
        return parseServerList(JSON.parse(readFileSync(file, "utf8")) as unknown);
      } catch {
        return initialServerList;
      }
    },
    write(list) {
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(list, null, 2)}\n`, "utf8");
      renameSync(temporary, file);
    },
  };
}
