import { describe, expect, it } from "vitest";

import {
  isNewStoreFormRequest,
  knowledgeStoreFormPresentation,
  reloadStillValid,
  shouldApplyReloadedKnowledge,
} from "./knowledge-current.js";

const created = { storeId: "default-store", ids: ["career-evidence"] };

describe("reloading the current knowledge base after a change elsewhere", () => {
  it("shows the base card 02 created when the panel showed nothing", () => {
    expect(shouldApplyReloadedKnowledge({ userTouched: false, shown: null, loaded: created })).toBe(
      true,
    );
    expect(shouldApplyReloadedKnowledge({ userTouched: true, shown: null, loaded: created })).toBe(
      true,
    );
  });

  it("follows a selection that changed elsewhere, even after the person used the panel", () => {
    const shown = { storeId: "opened-store", ids: ["other"] };
    expect(shouldApplyReloadedKnowledge({ userTouched: true, shown, loaded: created })).toBe(true);
    expect(
      shouldApplyReloadedKnowledge({
        userTouched: true,
        shown: { storeId: "default-store", ids: ["a"] },
        loaded: { storeId: "default-store", ids: ["b"] },
      }),
    ).toBe(true);
  });

  it("keeps the store the person opened when the selection is unchanged", () => {
    expect(
      shouldApplyReloadedKnowledge({
        userTouched: true,
        shown: { storeId: "default-store", ids: ["career-evidence"] },
        loaded: created,
      }),
    ).toBe(false);
  });

  it("drops a response that an operation or a newer reload overtook", () => {
    expect(
      reloadStillValid({ startedSequence: 2, currentSequence: 2, operationInFlight: false }),
    ).toBe(true);
    expect(
      reloadStillValid({ startedSequence: 2, currentSequence: 3, operationInFlight: false }),
    ).toBe(false);
    expect(
      reloadStillValid({ startedSequence: 2, currentSequence: 2, operationInFlight: true }),
    ).toBe(false);
  });
});

describe("card 02 asking the panel to show its store form", () => {
  it("treats a moved counter as a new request and an unchanged one as handled", () => {
    expect(isNewStoreFormRequest(0, 0)).toBe(false);
    expect(isNewStoreFormRequest(0, 1)).toBe(true);
    expect(isNewStoreFormRequest(1, 2)).toBe(true);
    expect(isNewStoreFormRequest(2, 2)).toBe(false);
  });
});

describe("how the create or open form is offered", () => {
  it("collapses it whenever a store exists", () => {
    for (const autoCreateSupported of [true, false]) {
      expect(
        knowledgeStoreFormPresentation({
          hasStore: true,
          autoCreateSupported,
          savedUnavailable: false,
        }),
      ).toBe("collapsed");
    }
  });

  it("shows it directly only without a store and without automatic creation", () => {
    expect(
      knowledgeStoreFormPresentation({
        hasStore: false,
        autoCreateSupported: false,
        savedUnavailable: false,
      }),
    ).toBe("form");
    expect(
      knowledgeStoreFormPresentation({
        hasStore: false,
        autoCreateSupported: true,
        savedUnavailable: false,
      }),
    ).toBe("collapsed");
  });

  it("opens the disclosure when the saved store cannot be opened", () => {
    expect(
      knowledgeStoreFormPresentation({
        hasStore: false,
        autoCreateSupported: true,
        savedUnavailable: true,
      }),
    ).toBe("open");
  });
});
