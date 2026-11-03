import type { PickerOpenResult, PickerView } from "./picker-contract.js";
import { parseServerAddress } from "./server-address.js";
import type { ServerCheck } from "./server-check.js";
import { type ServerListStore, withoutServer, withServer } from "./servers.js";

export interface PickerServiceDependencies {
  readonly store: ServerListStore;
  check(origin: string): Promise<ServerCheck>;
  /** Opens the server's window once it passed its check. */
  openServer(origin: string, check: ServerCheck & { reachable: true }): void;
  /** Clears the server's storage partition. */
  clearServerData(origin: string): Promise<void>;
}

/** The picker's actions, kept apart from Electron so they can be tested. */
export function createPickerService(dependencies: PickerServiceDependencies) {
  let unreachable: PickerView["unreachable"];
  const view = (): PickerView => ({
    servers: dependencies.store.read().servers,
    unreachable,
  });
  return {
    view,
    /** Remembers why a server could not be opened, for the picker to say. */
    setUnreachable(origin: string, reason: string): void {
      unreachable = { origin, reason };
    },
    async open(address: string, name?: string): Promise<PickerOpenResult> {
      const parsed = parseServerAddress(address);
      if (!parsed.ok) return parsed;
      const check = await dependencies.check(parsed.origin);
      if (!check.reachable) {
        unreachable = { origin: parsed.origin, reason: check.reason };
        return { ok: false, reason: check.reason };
      }
      const list = dependencies.store.read();
      const known = list.servers.find((server) => server.origin === parsed.origin);
      const label = name?.trim() || known?.name || parsed.origin;
      dependencies.store.write(
        withServer(list, { origin: parsed.origin, name: label.slice(0, 80) }),
      );
      unreachable = undefined;
      dependencies.openServer(parsed.origin, check);
      return { ok: true };
    },
    async remove(origin: string): Promise<PickerView> {
      const parsed = parseServerAddress(origin);
      if (parsed.ok) {
        dependencies.store.write(withoutServer(dependencies.store.read(), parsed.origin));
        await dependencies.clearServerData(parsed.origin);
        if (unreachable?.origin === parsed.origin) unreachable = undefined;
      }
      return view();
    },
  };
}
