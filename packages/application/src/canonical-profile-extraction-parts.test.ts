import { describe, expect, it } from "vitest";

import {
  createCanonicalProfileExtractionPartCache,
  runCanonicalProfileExtractionParts,
} from "./canonical-profile-extraction-parts.js";

describe("canonical profile extraction part cache", () => {
  it("evicts the oldest entry beyond its bound and refreshes re-set entries", () => {
    const cache = createCanonicalProfileExtractionPartCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 3);
    cache.set("c", 4);
    expect(cache.get("a")).toBe(3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(4);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("runCanonicalProfileExtractionParts", () => {
  it("keeps completed parts after a failure and clears them after success", async () => {
    const cache = createCanonicalProfileExtractionPartCache<string>();
    let failB = true;
    const ran: string[] = [];
    const run = async (part: string, cached: string | undefined) => {
      if (cached !== undefined) return { result: `replayed-${part}`, entry: cached };
      ran.push(part);
      if (part === "b" && failB) throw new Error("part b failed");
      return { result: `ran-${part}`, entry: part };
    };
    const options = { parts: ["a", "b", "c"], keyOf: (part: string) => part, run, cache };

    await expect(runCanonicalProfileExtractionParts(options)).rejects.toThrow("part b failed");
    expect(ran).toEqual(["a", "b", "c", "b"]);
    expect(cache.size()).toBe(2);

    failB = false;
    ran.length = 0;
    await expect(runCanonicalProfileExtractionParts(options)).resolves.toEqual([
      "replayed-a",
      "ran-b",
      "replayed-c",
    ]);
    expect(ran).toEqual(["b"]);
    expect(cache.size()).toBe(0);
  });

  it("throws the earliest failing part's error when several parts keep failing", async () => {
    const cache = createCanonicalProfileExtractionPartCache<string>();
    await expect(
      runCanonicalProfileExtractionParts({
        parts: [0, 1, 2],
        keyOf: String,
        run: async (part) => {
          if (part > 0) throw new Error(`part ${part} failed`);
          return { result: part, entry: String(part) };
        },
        cache,
      }),
    ).rejects.toThrow("part 1 failed");
  });
});
