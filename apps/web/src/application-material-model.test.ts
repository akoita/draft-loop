import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import {
  applicationMaterialProblem,
  careerProfileSourceNotice,
} from "./application-material-model.js";

describe("the career profile a new draft used (#2816)", () => {
  it("speaks only when a newer draft waits or nothing is reviewed yet", () => {
    expect(careerProfileSourceNotice(undefined)).toBeUndefined();
    expect(
      careerProfileSourceNotice({ version: 2, reviewed: true, newer_draft_waiting: false }),
    ).toBeUndefined();
    expect(
      careerProfileSourceNotice({ version: 2, reviewed: true, newer_draft_waiting: true }),
    ).toMatch(/reviewed career profile, version 2/u);
    expect(
      careerProfileSourceNotice({ version: 1, reviewed: false, newer_draft_waiting: false }),
    ).toMatch(/before it was reviewed/u);
  });
});

describe("a draft the server stopped waiting for", () => {
  it("says whether it recovers instead of naming a bare status", () => {
    const timedOut = new ApiRequestError(
      504,
      "unreadable-error",
      "The API answered 504.",
      undefined,
      undefined,
      {
        status: 504,
      },
    );
    expect(applicationMaterialProblem(timedOut)).toBe(
      "The server stopped waiting before this finished (error 504). It does not recover on its own: try again. Nothing you saved is lost.",
    );
  });
});
