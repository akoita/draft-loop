import { describe, expect, it, vi } from "vitest";

import { sweepQualityDigest } from "./quality-digest-sweep.js";

const now = new Date("2026-11-17T06:10:00.000Z");

describe("the daily quality digest sweep (#2916)", () => {
  it("builds yesterday's digest across active organisations, stores it and logs it", async () => {
    const save = vi.fn(async () => undefined);
    const spansBetween = vi.fn(async (organisationId: string) => [
      {
        runId: `${organisationId}-run`,
        name: "invoke_agent" as const,
        status: "error" as const,
        attributes: { "draftloop.step": "author", "error.type": "provider-error" },
      },
    ]);
    const lines: { message: string; fields: Record<string, unknown> }[] = [];

    const digest = await sweepQualityDigest(
      {
        claimDay: async () => true,
        save,
        organisationsActiveSince: async () => ["org-a", "org-b"],
        spansBetween,
        log: (message, fields) => lines.push({ message, fields }),
      },
      { now },
    );

    const from = new Date("2026-11-16T00:00:00.000Z");
    const to = new Date("2026-11-17T00:00:00.000Z");
    expect(spansBetween).toHaveBeenCalledWith("org-a", from, to);
    expect(spansBetween).toHaveBeenCalledWith("org-b", from, to);
    expect(digest).toMatchObject({ day: "2026-11-16", organisations: 2, runs: 2 });
    expect(digest?.failures[0]).toMatchObject({ errorType: "provider-error", count: 2 });
    expect(save).toHaveBeenCalledWith("2026-11-16", digest);
    expect(lines).toEqual([{ message: "quality digest", fields: { ...digest } }]);
  });

  it("does nothing when another start already claimed the day", async () => {
    const organisationsActiveSince = vi.fn(async () => []);
    const log = vi.fn();
    await expect(
      sweepQualityDigest(
        {
          claimDay: async () => false,
          save: async () => undefined,
          organisationsActiveSince,
          spansBetween: async () => [],
          log,
        },
        { now },
      ),
    ).resolves.toBeUndefined();
    expect(organisationsActiveSince).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
