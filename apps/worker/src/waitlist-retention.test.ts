import { describe, expect, it, vi } from "vitest";

import { sweepWaitlist, waitlistKeepDays } from "./waitlist-retention.js";

const now = new Date("2027-05-08T09:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

describe("the waitlist retention sweep (#2568)", () => {
  it("deletes entries older than six months and logs only the count", async () => {
    const joined = [
      { email: "old@example.test", at: now.getTime() - (waitlistKeepDays + 1) * dayMs },
      { email: "new@example.test", at: now.getTime() - 10 * dayMs },
    ];
    const kept = [...joined];
    const lines: { message: string; fields: Record<string, unknown> }[] = [];
    const deleteJoinedBefore = vi.fn(async (cutoff: Date) => {
      const before = kept.length;
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        if ((kept[index]?.at ?? 0) < cutoff.getTime()) kept.splice(index, 1);
      }
      return before - kept.length;
    });

    await expect(
      sweepWaitlist(
        { deleteJoinedBefore, log: (message, fields) => lines.push({ message, fields }) },
        { now },
      ),
    ).resolves.toBe(1);

    expect(kept.map((entry) => entry.email)).toEqual(["new@example.test"]);
    expect(lines).toEqual([{ message: "old waitlist entries deleted", fields: { deleted: 1 } }]);
  });

  it("deletes unconfirmed entries 48 hours after their last link", async () => {
    const deleteUnconfirmedBefore = vi.fn(async () => 2);
    const lines: unknown[] = [];

    await expect(
      sweepWaitlist(
        {
          deleteJoinedBefore: async () => 0,
          deleteUnconfirmedBefore,
          log: (message, fields) => lines.push({ message, fields }),
        },
        { now },
      ),
    ).resolves.toBe(2);

    expect(deleteUnconfirmedBefore).toHaveBeenCalledWith(new Date(now.getTime() - 2 * dayMs));
    expect(lines).toEqual([
      { message: "unconfirmed waitlist entries deleted", fields: { unconfirmed: 2 } },
    ]);
  });

  it("stays quiet when nothing is old enough", async () => {
    const log = vi.fn();
    await expect(sweepWaitlist({ deleteJoinedBefore: async () => 0, log }, { now })).resolves.toBe(
      0,
    );
    expect(log).not.toHaveBeenCalled();
  });
});
