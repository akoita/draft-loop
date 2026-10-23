import { describe, expect, it } from "vitest";

import { createScreenMemory, currentBriefId, currentRunId } from "./screen-memory.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const application = {
  id: "default",
  name: "Default application",
  nameChosen: false,
  status: "drafting",
  isDefault: true,
  archivedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  briefs: [],
  runs: [],
  chosenRunId: null,
};

describe("screen memory", () => {
  it("remembers the last brief and run", () => {
    const storage = memoryStorage();
    const memory = createScreenMemory(() => storage);

    memory.rememberBrief("brief-1");
    memory.rememberRun("run-1");

    expect(createScreenMemory(() => storage).read()).toEqual({
      briefId: "brief-1",
      runId: "run-1",
    });
  });

  it("starts afresh when storage is missing, refused or holds something else", () => {
    expect(createScreenMemory(() => undefined).read()).toEqual({});
    expect(
      createScreenMemory(() => {
        throw new Error("blocked");
      }).read(),
    ).toEqual({});
    const storage = memoryStorage();
    storage.setItem("draft-loop.screen", "not json");
    expect(createScreenMemory(() => storage).read()).toEqual({});
  });

  it("prefers what the application lists, then what the browser remembers", () => {
    const remembered = { briefId: "brief-remembered", runId: "run-remembered" };
    expect(currentBriefId(application, remembered)).toBe("brief-remembered");
    expect(currentRunId(application, remembered)).toBe("run-remembered");
    const listed = {
      ...application,
      briefs: [
        {
          briefId: "brief-1",
          latestVersion: 1,
          status: "draft",
          createdAt: "2026-10-23T00:00:00Z",
        },
      ],
      runs: [
        {
          id: "run-1",
          state: "drafting",
          startedAt: "2026-10-23T00:00:00Z",
          updatedAt: "2026-10-23T00:00:00Z",
        },
      ],
    };
    expect(currentBriefId(listed, remembered)).toBe("brief-1");
    expect(currentRunId(listed, remembered)).toBe("run-1");
    expect(currentRunId(undefined, {})).toBeUndefined();
  });
});
