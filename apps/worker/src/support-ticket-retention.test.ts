import { describe, expect, it, vi } from "vitest";

import { sweepSupportTickets } from "./support-ticket-retention.js";

const now = new Date("2027-05-08T09:00:00.000Z");

describe("the support ticket retention sweep (#2883)", () => {
  it("deletes tickets older than 90 days and logs only the count", async () => {
    const deleteSupportTicketsBefore = vi.fn(async () => 3);
    const lines: { message: string; fields: Record<string, unknown> }[] = [];

    await expect(
      sweepSupportTickets(
        { deleteSupportTicketsBefore, log: (message, fields) => lines.push({ message, fields }) },
        { now },
      ),
    ).resolves.toBe(3);

    expect(deleteSupportTicketsBefore).toHaveBeenCalledWith(new Date("2027-02-07T09:00:00.000Z"));
    expect(lines).toEqual([{ message: "old support tickets deleted", fields: { deleted: 3 } }]);
  });

  it("stays quiet when nothing is old enough", async () => {
    const log = vi.fn();
    await expect(
      sweepSupportTickets({ deleteSupportTicketsBefore: async () => 0, log }, { now }),
    ).resolves.toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
});
