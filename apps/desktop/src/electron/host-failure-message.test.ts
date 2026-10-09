import {
  CliUserError,
  JobRequirementUserError,
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

describe("refused run start or resume", () => {
  const dispatch = (type: string) =>
    ({ type: "review.dispatch", input: { action: { type } } }) as never;
  const runStart = { type: "run.start", input: {} } as never;
  const generic = "Starting the review failed with an unexpected error.";

  it("shows a CliUserError message on a review start, a run start and a resume", () => {
    const error = new CliUserError("The selected candidate profile version is not reviewed.");
    expect(hostFailureMessage(dispatch("start"), error)).toBe(error.message);
    expect(hostFailureMessage(runStart, error)).toBe(error.message);
    expect(hostFailureMessage(dispatch("resume"), error)).toBe(error.message);
  });

  it("keeps a plain Error generic", () => {
    expect(hostFailureMessage(dispatch("start"), new Error("boom"))).toBe(generic);
    expect(hostFailureMessage(runStart, new Error("boom"))).toBe(generic);
  });

  it("prefers the requirement summary over the full message", () => {
    const error = new JobRequirementUserError("No requirements were found.");
    expect(hostFailureMessage(dispatch("start"), error)).toBe("No requirements were found.");
  });

  it("keeps a message that quotes a path generic", () => {
    const error = new CliUserError("No DraftLoop workspace found at /home/me/work.");
    expect(hostFailureMessage(dispatch("start"), error)).toBe(generic);
  });

  it("does not widen to other review actions", () => {
    const error = new CliUserError("Refused.");
    expect(hostFailureMessage(dispatch("pause"), error)).toBe(
      "Pausing the review failed with an unexpected error.",
    );
  });
});
