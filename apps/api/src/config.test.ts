import { describe, expect, it } from "vitest";
import { ApiConfigError, readApiConfig } from "./config.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";

describe("readApiConfig", () => {
  it("reads Cloud Run's port and the owner token", () => {
    expect(readApiConfig({ PORT: "9000", DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toEqual({
      host: "0.0.0.0",
      port: 9000,
      ownerToken,
    });
  });

  it("defaults to port 8080", () => {
    expect(readApiConfig({ DRAFT_LOOP_API_OWNER_TOKEN: ownerToken }).port).toBe(8080);
  });

  it.each([
    ["missing", undefined],
    ["too short", "short-token"],
    ["with whitespace", `${ownerToken} ${ownerToken}`],
  ])("refuses an owner token that is %s", (_label, token) => {
    expect(() =>
      readApiConfig(token === undefined ? {} : { DRAFT_LOOP_API_OWNER_TOKEN: token }),
    ).toThrow(ApiConfigError);
  });

  it.each(["0", "65536", "80a", ""])("refuses port %j", (port) => {
    expect(() => readApiConfig({ PORT: port, DRAFT_LOOP_API_OWNER_TOKEN: ownerToken })).toThrow(
      ApiConfigError,
    );
  });
});
