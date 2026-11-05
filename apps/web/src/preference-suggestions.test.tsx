import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "./api-client.js";
import { decidePreferenceSuggestion } from "./preference-suggestions.js";

const id = "preference-0123456789abcdef";

describe("deciding a suggested preference", () => {
  it("calls the accept or dismiss route for the workspace", async () => {
    const call = vi.fn(async () => ({}));
    expect(await decidePreferenceSuggestion({ call } as never, "ws", id, "accept")).toBeUndefined();
    expect(
      await decidePreferenceSuggestion({ call } as never, "ws", id, "dismiss"),
    ).toBeUndefined();
    expect(call.mock.calls).toEqual([
      [
        "POST /v1/workspaces/{workspaceId}/preference-suggestions/{suggestionId}/accept",
        { path: { workspaceId: "ws", suggestionId: id } },
      ],
      [
        "POST /v1/workspaces/{workspaceId}/preference-suggestions/{suggestionId}/dismiss",
        { path: { workspaceId: "ws", suggestionId: id } },
      ],
    ]);
  });

  it("returns the refusal to show when the API refuses", async () => {
    const call = vi.fn(async () => {
      throw new ApiRequestError(422, "rejected", "No preference suggestion is waiting.");
    });
    const problem = await decidePreferenceSuggestion({ call } as never, "ws", id, "accept");
    expect(problem).toMatch(/^The preference could not be saved\./u);
  });
});
