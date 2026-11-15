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

  it("adds the work journal review with the owner token only, where the server serves it", () => {
    const owner = renderToStaticMarkup(
      webHostPanels(unusedClient, "owner", undefined).evidenceAfter?.({ revision: 0 }),
    );
    const signIn = renderToStaticMarkup(
      webHostPanels(unusedClient, "sign-in", undefined).evidenceAfter?.({ revision: 0 }),
    );

    expect(owner).toContain(">Work journal</h2>");
    expect(owner).not.toContain("Accept notes from agents");
    expect(signIn).not.toContain("Work journal");
  });

  it("shows the career interview and its way to start to signed-in users too (#2735)", () => {
    const panels = webHostPanels(unusedClient, "sign-in", undefined);
    const signIn = renderToStaticMarkup(panels.evidenceAfter?.({ revision: 0 }));

    expect(signIn).toContain(">Career interview</h2>");
    expect(signIn).toContain("Start a conversation");
    expect(panels.careerConversation).toBe(true);
    expect(webHostPanels(unusedClient, "owner", undefined).careerConversation).toBe(true);
  });

  it("puts the optional panels most used first, and private sections in Advanced options", () => {
    const owner = renderToStaticMarkup(
      webHostPanels(unusedClient, "owner", undefined).evidenceAfter?.({ revision: 0 }),
    );
    const interview = owner.indexOf(">Career interview</h2>");
    const journal = owner.indexOf(">Work journal</h2>");
    const advanced = renderToStaticMarkup(
      webHostPanels(unusedClient, "owner", undefined).evidenceAdvanced?.({
        revision: 0,
        setNote: () => undefined,
      }),
    );

    expect(interview).toBeGreaterThan(-1);
    expect(interview).toBeLessThan(journal);
    expect(owner).not.toContain("Private sections");
    expect(advanced).toContain(">Private sections</h3>");
  });
});
