import { describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import {
  currentNotice,
  parseStoredNotice,
  readServiceNoticeSecret,
  type StoredServiceNotice,
  secretServiceNotice,
} from "./service-notice.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const hour = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function notice(startOffset: number, endOffset: number, readOnly = true): StoredServiceNotice {
  return { kind: "maintenance", startsAt: iso(startOffset), endsAt: iso(endOffset), readOnly };
}

async function withApi<T>(
  stored: StoredServiceNotice | undefined,
  run: (app: Awaited<ReturnType<typeof buildApi>>) => Promise<T>,
): Promise<T> {
  const app = await buildApi({ ownerToken, serviceNotice: async () => stored });
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

describe("stored notice", () => {
  it("reads an empty value, {} or invalid text as no notice", () => {
    expect(parseStoredNotice(undefined)).toBeUndefined();
    expect(parseStoredNotice("  ")).toBeUndefined();
    expect(parseStoredNotice("{}")).toBeUndefined();
    expect(parseStoredNotice("not json")).toBeUndefined();
    expect(parseStoredNotice('{"kind":"maintenance"}')).toBeUndefined();
  });

  it("reads a planned maintenance", () => {
    const text =
      '{"kind":"maintenance","startsAt":"2026-12-01T20:00:00Z","endsAt":"2026-12-01T22:00:00Z","readOnly":true}';
    expect(parseStoredNotice(text)).toEqual({
      kind: "maintenance",
      startsAt: "2026-12-01T20:00:00Z",
      endsAt: "2026-12-01T22:00:00Z",
      readOnly: true,
    });
  });

  it("is upcoming, ongoing, then overrunning only while changes stay paused", () => {
    const stored = parseStoredNotice(
      '{"kind":"maintenance","startsAt":"2026-12-01T20:00:00Z","endsAt":"2026-12-01T22:00:00Z","readOnly":true}',
    );
    expect(currentNotice(stored, new Date("2026-12-01T19:00:00Z"))?.state).toBe("upcoming");
    expect(currentNotice(stored, new Date("2026-12-01T21:00:00Z"))?.state).toBe("ongoing");
    expect(currentNotice(stored, new Date("2026-12-01T23:00:00Z"))?.state).toBe("overrunning");
    const open = stored === undefined ? undefined : { ...stored, readOnly: false };
    expect(currentNotice(open, new Date("2026-12-01T23:00:00Z"))).toBeUndefined();
  });

  it("names the secret version from the environment, or none", () => {
    expect(readServiceNoticeSecret({})).toBeUndefined();
    expect(
      readServiceNoticeSecret({
        DRAFT_LOOP_SERVICE_NOTICE_SECRET: " projects/p/secrets/service-notice/versions/latest ",
      }),
    ).toBe("projects/p/secrets/service-notice/versions/latest");
  });

  it("treats a secret that cannot be read as no notice", async () => {
    const errors: unknown[] = [];
    const source = secretServiceNotice({
      secret: "projects/p/secrets/service-notice/versions/latest",
      client: {
        accessSecretVersion: async () => {
          throw new Error("NOT_FOUND");
        },
      },
      onReadError: (error) => errors.push(error),
    });
    expect(await source()).toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("reads the notice from the secret", async () => {
    const text =
      '{"kind":"maintenance","startsAt":"2026-12-01T20:00:00Z","endsAt":"2026-12-01T22:00:00Z"}';
    const source = secretServiceNotice({
      secret: "projects/p/secrets/service-notice/versions/latest",
      client: { accessSecretVersion: async () => [{ payload: { data: text } }] },
    });
    expect((await source())?.endsAt).toBe("2026-12-01T22:00:00Z");
  });
});

describe("service notice route", () => {
  it("answers no notice without a credential when none is set", async () => {
    const response = await withApi(undefined, (app) =>
      app.inject({ method: "GET", url: "/v1/service-notice" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ notice: null });
  });

  it("serves an upcoming maintenance publicly", async () => {
    const response = await withApi(notice(hour, 3 * hour), (app) =>
      app.inject({ method: "GET", url: "/v1/service-notice" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ notice: { state: "upcoming", readOnly: true } });
  });
});

describe("read-only maintenance", () => {
  const write = {
    method: "POST" as const,
    url: "/v1/workspaces",
    payload: {},
    headers: { authorization: `Bearer ${ownerToken}` },
  };

  it("refuses a write once a read-only maintenance has started, with Retry-After", async () => {
    const response = await withApi(notice(-hour, hour), (app) => app.inject(write));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "service_maintenance" } });
    expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(3_500);
  });

  it("keeps refusing writes after the announced end until the notice is cleared", async () => {
    const response = await withApi(notice(-2 * hour, -hour), (app) => app.inject(write));
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("60");
  });

  it("lets writes through before it starts and when it pauses nothing", async () => {
    for (const stored of [notice(hour, 2 * hour), notice(-hour, hour, false)]) {
      const response = await withApi(stored, (app) => app.inject(write));
      expect(response.statusCode).not.toBe(503);
    }
  });

  it("keeps reads and the screen's crash reports open", async () => {
    await withApi(notice(-hour, hour), async (app) => {
      expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
      const report = await app.inject({ method: "POST", url: "/v1/client-errors", payload: {} });
      expect(report.statusCode).not.toBe(503);
    });
  });
});
