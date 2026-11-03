import { describe, expect, it, vi } from "vitest";

import { createPickerService } from "./picker-service.js";
import { thisComputerOrigin } from "./server-address.js";
import type { ServerCheck } from "./server-check.js";
import { initialServerList, type ServerList, type ServerListStore } from "./servers.js";

function memoryStore(
  initial: ServerList = initialServerList,
): ServerListStore & { list: ServerList } {
  const store = {
    list: initial,
    read: () => store.list,
    write: (list: ServerList) => {
      store.list = list;
    },
  };
  return store;
}

function service(check: ServerCheck) {
  const store = memoryStore();
  const openServer = vi.fn();
  const clearServerData = vi.fn(async () => {});
  const picker = createPickerService({
    store,
    check: async () => check,
    openServer,
    clearServerData,
  });
  return { picker, store, openServer, clearServerData };
}

describe("picker service", () => {
  it("saves and opens a server that passes its check", async () => {
    const { picker, store, openServer } = service({ reachable: true, signIn: "owner" });
    expect(await picker.open("draftloop.example", " Team ")).toEqual({ ok: true });
    expect(store.list.selected).toBe("https://draftloop.example");
    expect(store.list.servers).toContainEqual({
      origin: "https://draftloop.example",
      name: "Team",
    });
    expect(openServer).toHaveBeenCalledWith("https://draftloop.example", {
      reachable: true,
      signIn: "owner",
    });
  });

  it("refuses a bad address without checking it", async () => {
    const { picker, openServer } = service({ reachable: true, signIn: "owner" });
    expect(await picker.open("http://draftloop.example")).toMatchObject({ ok: false });
    expect(openServer).not.toHaveBeenCalled();
  });

  it("says why a server cannot be opened, and keeps the list", async () => {
    const { picker, store, openServer } = service({
      reachable: false,
      reason: "The server cannot be reached.",
    });
    expect(await picker.open(thisComputerOrigin)).toEqual({
      ok: false,
      reason: "The server cannot be reached.",
    });
    expect(picker.view().unreachable).toEqual({
      origin: thisComputerOrigin,
      reason: "The server cannot be reached.",
    });
    expect(store.list).toEqual(initialServerList);
    expect(openServer).not.toHaveBeenCalled();
  });

  it("forgets a server and clears its data", async () => {
    const { picker, store, clearServerData } = service({ reachable: true, signIn: "owner" });
    picker.setUnreachable(thisComputerOrigin, "down");
    const view = await picker.remove(thisComputerOrigin);
    expect(view).toEqual({ servers: [], unreachable: undefined });
    expect(store.list.selected).toBeUndefined();
    expect(clearServerData).toHaveBeenCalledWith(thisComputerOrigin);
  });
});
