import { describe, expect, it } from "vitest";

import { createWorkJournalApi, isRetryableStatus, WorkJournalApiError } from "./client.js";

function api(answer: () => Response | Promise<Response>) {
  return createWorkJournalApi({
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => "fixture-token",
    fetch: async () => answer(),
  });
}

const refusal = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: "Refused." } }), { status });

describe("agent channel errors say whether a retry can help", () => {
  it.each([
    [429, "rate_limited", true],
    [408, "timeout", true],
    [500, "internal_error", true],
    [502, "bad_gateway", true],
    [503, "unavailable", true],
    [504, "gateway_timeout", true],
    [400, "invalid_request", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [409, "conflict", false],
    [422, "invalid_note", false],
  ] as const)("answers %i with retryable %s", async (status, code, retryable) => {
    expect(isRetryableStatus(status)).toBe(retryable);
    await expect(api(() => refusal(status, code)).list({})).rejects.toMatchObject({
      code,
      retryable,
    });
  });

  it("marks an unreachable server retryable and a missing token not", async () => {
    await expect(
      api(() => Promise.reject(new TypeError("fetch failed"))).list({}),
    ).rejects.toMatchObject({ code: "server_unreachable", retryable: true });
    await expect(api(() => new Response("{}", { status: 401 })).list({})).rejects.toMatchObject({
      code: "not_signed_in",
      retryable: false,
    });
  });

  it("defaults a constructed refusal to not retryable", () => {
    expect(new WorkJournalApiError("x", "y").retryable).toBe(false);
  });
});
