import { describe, expect, it } from "vitest";

import { careerProfileSourceNotice } from "./application-material-model.js";

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
