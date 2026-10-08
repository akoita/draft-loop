import {
  OpportunityJobPageUnreadableError,
  opportunityJobPageUnreadableMessage,
} from "@draft-loop/application";
import { describe, expect, it } from "vitest";

import { hostFailureMessage } from "./host-failure-message.js";

describe("unreadable job page failure", () => {
  const create = {
    type: "opportunity.create",
    input: { workspaceId: "w", sources: [], providerTransmissionApproved: true },
  } as never;

  it("crosses the bridge as the fixed paste-the-text sentence", () => {
    expect(hostFailureMessage(create, new OpportunityJobPageUnreadableError())).toBe(
      opportunityJobPageUnreadableMessage,
    );
    expect(opportunityJobPageUnreadableMessage).toContain("Paste the job text instead.");
  });

  it("does not widen to other commands or other errors", () => {
    const get = { type: "opportunity.get", input: { workspaceId: "w", briefId: "b" } } as never;
    expect(hostFailureMessage(get, new OpportunityJobPageUnreadableError())).toBe(
      "The opportunity action failed with an unexpected error.",
    );
    expect(hostFailureMessage(create, new Error("private page text"))).toBe(
      "The opportunity action failed with an unexpected error.",
    );
  });
});
