import { describe, expect, it } from "vitest";
import { ApiRequestError, describeError } from "./api-client.js";
import { refusalText } from "./refusal-text.js";

describe("refusal text", () => {
  it("words a known code from its params and keeps the API's message for any other", () => {
    expect(
      refusalText({ code: "not_found", message: "x", params: { resource: "workspace" } }),
    ).toBe("No such workspace.");
    expect(refusalText({ code: "not_found", message: "No such fact." })).toBe("No such fact.");
    expect(refusalText({ code: "rejected", message: "That name is taken." })).toBe(
      "That name is taken.",
    );
    expect(refusalText({ code: "unreadable-error", message: "x", params: { status: 502 } })).toBe(
      "The API answered 502.",
    );
  });

  it("describes a refused call by its code and an unreachable service in words", () => {
    const refused = new ApiRequestError(404, "not_found", "No such run.", undefined, undefined, {
      resource: "run",
    });
    expect(refused.params).toEqual({ resource: "run" });
    expect(describeError(refused)).toBe("No such run.");
    expect(describeError(new TypeError("fetch failed"))).toContain("could not be reached");
  });

  it("says when a plan's daily model calls outside runs come back (#2487)", () => {
    expect(
      refusalText({ code: "model_call_cap_reached", message: "x", params: { limit: 20 } }),
    ).toBe(
      "Your plan allows 20 interview turns, drafts and profile updates a day, and today's are used. They come back at midnight UTC.",
    );
  });

  it("says when an application's credit covers no more Prepare calls (#2680)", () => {
    expect(
      refusalText({ code: "prepare_fair_use_reached", message: "x", params: { limit: 20 } }),
    ).toBe("This application has used the 20 drafts, guides and research runs its credit covers.");
  });
});
