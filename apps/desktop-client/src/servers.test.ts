import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { thisComputerOrigin } from "./server-address.js";
import {
  createServerListStore,
  initialServerList,
  parseServerList,
  serverListFilename,
  withoutServer,
  withServer,
} from "./servers.js";

describe("server list", () => {
  it("starts with this computer selected", () => {
    expect(initialServerList.selected).toBe(thisComputerOrigin);
    expect(parseServerList(undefined)).toEqual(initialServerList);
    expect(parseServerList({ servers: "x" })).toEqual(initialServerList);
  });

  it("drops entries that no longer pass the address rules, and duplicates", () => {
    const list = parseServerList({
      servers: [
        { origin: "https://a.example/", name: " A " },
        { origin: "http://b.example", name: "insecure" },
        { origin: "https://a.example", name: "again" },
        { origin: 4 },
        { origin: "https://c.example" },
      ],
      selected: "http://b.example",
    });
    expect(list).toEqual({
      servers: [
        { origin: "https://a.example", name: "A" },
        { origin: "https://c.example", name: "https://c.example" },
      ],
      selected: undefined,
    });
  });

  it("adds, selects and removes servers", () => {
    const added = withServer(initialServerList, { origin: "https://a.example", name: "A" });
    expect(added.selected).toBe("https://a.example");
    expect(added.servers).toHaveLength(2);
    const removed = withoutServer(added, "https://a.example");
    expect(removed).toEqual({ servers: initialServerList.servers, selected: undefined });
    expect(withoutServer(added, thisComputerOrigin).selected).toBe("https://a.example");
  });

  it("round-trips through its file and survives a broken one", () => {
    const directory = mkdtempSync(join(tmpdir(), "draftloop-servers-"));
    const store = createServerListStore(directory);
    expect(store.read()).toEqual(initialServerList);
    const list = withServer(initialServerList, { origin: "https://a.example", name: "A" });
    store.write(list);
    expect(store.read()).toEqual(list);
    expect(JSON.parse(readFileSync(join(directory, serverListFilename), "utf8"))).toEqual(list);
    writeFileSync(join(directory, serverListFilename), "{", "utf8");
    expect(store.read()).toEqual(initialServerList);
  });
});
