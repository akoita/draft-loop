import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { webHostPanels } from "./web-host-panels.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

describe("the web's host panels", () => {
  it("adds the storage permission and the start dialog's panel in sign-in mode", () => {
    const panels = webHostPanels(unusedClient, "sign-in", undefined);

    expect(renderToStaticMarkup(panels.evidenceBefore)).toContain(
      "Reading the candidate&#x27;s consents",
    );
    expect(panels.startDialog).toBeDefined();
    expect(panels.evidenceAfter?.({ revision: 0 })).toBeDefined();
  });

  it("adds neither in owner-token mode, where the server enforces neither", () => {
    const panels = webHostPanels(unusedClient, "owner", undefined);

    expect(panels.evidenceBefore).toBeUndefined();
    expect(panels.startDialog).toBeUndefined();
    expect(panels.evidenceAfter?.({ revision: 0 })).toBeDefined();
  });
});
