import { describe, expect, it, vi } from "vitest";

import {
  type BetaRetentionPorts,
  type RetentionActivityRow,
  sweepBetaRetention,
} from "./beta-retention.js";

const dayMs = 24 * 60 * 60 * 1000;
const now = new Date("2027-02-01T09:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * dayMs).toISOString();

function fakePorts(rows: RetentionActivityRow[], overrides: Partial<BetaRetentionPorts> = {}) {
  const store = new Map(rows.map((row) => [row.organisationId, { ...row }]));
  const lines: { message: string; fields: Record<string, unknown> }[] = [];
  const send = vi.fn<NonNullable<BetaRetentionPorts["send"]>>(async () => true);
  const erase = vi.fn<BetaRetentionPorts["erase"]>(async () => ({
    state: "erased",
    records: 1,
    objectsRemoved: 2,
    rowsRemoved: 30,
  }));
  const ports: BetaRetentionPorts = {
    inactiveSince: async (cutoff) =>
      [...store.values()].filter((row) => Date.parse(row.lastActiveAt) < cutoff.getTime()),
    markWarned: async (organisationId, at) => {
      const row = store.get(organisationId);
      if (row === undefined || row.warnedAt !== null) return false;
      store.set(organisationId, { ...row, warnedAt: at.toISOString() });
      return true;
    },
    clearWarning: async (organisationId) => {
      const row = store.get(organisationId);
      if (row !== undefined) store.set(organisationId, { ...row, warnedAt: null });
    },
    planOf: async (organisationId) => (organisationId.startsWith("pro-") ? "pro" : "beta"),
    ownersOf: async () => [{ email: "owner@example.test", locale: "fr" }],
    erase,
    send,
    serviceUrl: "https://app.example.test",
    log: (_severity, message, fields) => lines.push({ message, fields }),
    ...overrides,
  };
  return { ports, store, lines, send, erase };
}

describe("the beta retention sweep (#2540)", () => {
  it("warns the owners of a Beta organisation inactive for 76 days, once", async () => {
    const { ports, store, lines, send, erase } = fakePorts([
      { organisationId: "beta-a", lastActiveAt: daysAgo(77), warnedAt: null },
      { organisationId: "beta-recent", lastActiveAt: daysAgo(10), warnedAt: null },
      { organisationId: "pro-a", lastActiveAt: daysAgo(200), warnedAt: null },
    ]);

    await expect(sweepBetaRetention(ports, { now })).resolves.toEqual({
      warned: 1,
      erased: 0,
      postponed: 0,
    });
    await sweepBetaRetention(ports, { now });

    expect(send).toHaveBeenCalledTimes(1);
    const [template, message] = send.mock.calls[0] ?? [];
    expect(template).toBe("beta_inactivity_warning");
    expect(message?.to).toBe("owner@example.test");
    expect(message?.text).toContain("supprimé le 15 février 2027");
    expect(store.get("beta-a")?.warnedAt).toBe(now.toISOString());
    expect(erase).not.toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toContain("owner@");
  });

  it("erases a Beta organisation 90 days inactive and warned 14 days ago", async () => {
    const { ports, erase, lines } = fakePorts([
      { organisationId: "beta-old", lastActiveAt: daysAgo(91), warnedAt: daysAgo(14) },
      { organisationId: "beta-late-warning", lastActiveAt: daysAgo(120), warnedAt: daysAgo(3) },
    ]);

    await expect(sweepBetaRetention(ports, { now })).resolves.toEqual({
      warned: 0,
      erased: 1,
      postponed: 0,
    });
    expect(erase.mock.calls.map(([organisationId]) => organisationId)).toEqual(["beta-old"]);
    expect(lines).toContainEqual({
      message: "inactive beta organisation erased",
      fields: {
        erasure: { organisationId: "beta-old", records: 1, objectsRemoved: 2, rowsRemoved: 30 },
      },
    });
  });

  it("keeps an organisation that came back before the deadline", async () => {
    // A member request moved the activity forward and cleared the warning.
    const { ports, send, erase } = fakePorts([
      { organisationId: "beta-back", lastActiveAt: daysAgo(1), warnedAt: null },
    ]);

    await expect(sweepBetaRetention(ports, { now })).resolves.toEqual({
      warned: 0,
      erased: 0,
      postponed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
  });

  it("postpones while a run is active, and warns nobody when mail is off", async () => {
    const running = fakePorts(
      [{ organisationId: "beta-busy", lastActiveAt: daysAgo(95), warnedAt: daysAgo(20) }],
      { erase: async () => ({ state: "run-active" }) },
    );
    await expect(sweepBetaRetention(running.ports, { now })).resolves.toMatchObject({
      postponed: 1,
    });

    const mailOff = fakePorts(
      [{ organisationId: "beta-a", lastActiveAt: daysAgo(200), warnedAt: null }],
      { send: undefined },
    );
    await expect(sweepBetaRetention(mailOff.ports, { now })).resolves.toEqual({
      warned: 0,
      erased: 0,
      postponed: 0,
    });
    expect(mailOff.store.get("beta-a")?.warnedAt).toBeNull();
    expect(mailOff.lines.map((line) => line.message)).toEqual([
      "beta retention warning not sent: mail is off",
    ]);
  });

  it("forgets a warning no owner received, so the next sweep tries again", async () => {
    const { ports, store } = fakePorts(
      [{ organisationId: "beta-a", lastActiveAt: daysAgo(80), warnedAt: null }],
      { send: async () => false },
    );

    await expect(sweepBetaRetention(ports, { now })).resolves.toMatchObject({ warned: 0 });
    expect(store.get("beta-a")?.warnedAt).toBeNull();
  });
});
