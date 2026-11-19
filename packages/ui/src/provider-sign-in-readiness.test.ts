import { describe, expect, it } from "vitest";
import { serverHeldProviderSignIn } from "./provider-sign-in-readiness.js";

describe("provider sign-in readiness", () => {
  it("reads as ready, because the server holds the provider keys", () => {
    expect(serverHeldProviderSignIn()).toEqual({
      state: "ready",
      summary: "The service provides the models",
    });
  });
});
