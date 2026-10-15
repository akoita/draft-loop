import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { createFixtureReviewState, type ReviewAction } from "./model.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { ReviewWorkspace } from "./review.js";
import { ReviewFooter, type ReviewFooterProps } from "./review-footer.js";
import {
  maximumRevisionDirectionLength,
  requestRevisionAction,
  revisionDirectionsUnavailableNote,
  sendRevisionRequest,
} from "./revision-direction.js";
import { normalizeRunAuthorInput, runAuthorInputDisplay } from "./run-author-input.js";

const noop = (): void => undefined;

function reviewPort() {
  const state = createFixtureReviewState();
  const invoke = vi.fn<NativeBridge["invoke"]>(async (command) =>
    command.type === "review.load" || command.type === "review.dispatch"
      ? { ok: true, value: state }
      : { ok: false, error: { code: "capability-unavailable", message: command.type } },
  );
  const port = createBridgeReviewPort(
    createNativeCapabilityPort({ capabilities: bridgeCapabilities as never, invoke }),
  );
  return { port, invoke, state };
}

/*
 * Drift proof: the action goes through the real capability port and its real validator, so a
 * field added to the action type but not to the runtime allowlist fails here, not in the app.
 */
describe("Request revision with directions over the bridge", () => {
  it("delivers the candidate's direction, trimmed, to the host", async () => {
    const { port, invoke, state } = reviewPort();
    await port.dispatch(state, {
      type: "request-revision",
      candidateDirection: "  Lead with tokenisation.  ",
    });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.dispatch",
      input: {
        workspaceId: state.workspaceId,
        runId: state.runId,
        action: { type: "request-revision", candidateDirection: "Lead with tokenisation." },
      },
    });
  });

  it("still delivers a plain request without a direction", async () => {
    const { port, invoke, state } = reviewPort();
    await port.dispatch(state, { type: "request-revision" });
    const sent = invoke.mock.calls.at(-1)?.[0] as { input: { action: unknown } };
    expect(sent.input.action).toEqual({ type: "request-revision" });
  });

  it("refuses a blank, oversized, control-character or unknown field", () => {
    const dispatch = (action: unknown) =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: { workspaceId: "workspace-1", runId: "run-1", action },
      });
    expect(() => dispatch({ type: "request-revision", candidateDirection: "   " })).toThrow();
    expect(() =>
      dispatch({
        type: "request-revision",
        candidateDirection: "x".repeat(maximumRevisionDirectionLength + 1),
      }),
    ).toThrow();
    expect(() =>
      dispatch({ type: "request-revision", candidateDirection: "bell\u0007" }),
    ).toThrow();
    expect(() => dispatch({ type: "request-revision", candidateDirection: 4 })).toThrow();
    expect(() => dispatch({ type: "request-revision", note: "x" })).toThrow();
    expect(() =>
      dispatch({
        type: "request-revision",
        candidateDirection: `Lead with X.\nDrop Y.${"x".repeat(maximumRevisionDirectionLength - 20)}`,
      }),
    ).not.toThrow();
  });

  it("carries the recorded direction in the author input through the real validator", async () => {
    const authorInput = {
      sentChunkCount: 3,
      sentFactCount: 1,
      unmatchedRequirements: [],
      candidateDirection: { text: "Drop certification dates.", createdAt: "2026-10-15T10:00:00Z" },
    };
    const bridge: NativeBridge = {
      capabilities: ["review.load"],
      invoke: async () =>
        ({ ok: true, value: { ...createFixtureReviewState(), authorInput } }) as never,
    };
    const loaded = await createCapabilityPort(bridge).execute({ type: "review.load", input: {} });
    expect(loaded).toMatchObject({ ok: true, value: { authorInput } });
    expect(normalizeRunAuthorInput({ ...authorInput, candidateDirection: { text: "" } })).toBe(
      undefined,
    );
    expect(runAuthorInputDisplay(normalizeRunAuthorInput(authorInput))?.direction).toEqual(
      authorInput.candidateDirection,
    );
  });
});

describe("the directions field", () => {
  const props = (direction: string): ReviewFooterProps =>
    ({
      blocker: { tone: "safe", text: "Ready" },
      readOnly: false,
      errorMessage: null,
      statusLine: "",
      detail: null,
      conditions: [],
      editNote: null,
      detailsOpen: false,
      onDetailsOpenChange: noop,
      recovery: null,
      approve: { disabled: true, onApprove: noop },
      override: null,
      revision: { disabled: false, onRequest: noop, direction, onDirectionChange: noop },
      exportAction: {
        disabled: true,
        pathLabel: "",
        again: false,
        pendingSeconds: null,
        onExport: noop,
      },
    }) as unknown as ReviewFooterProps;

  it("sits beside Request revision, labelled optional and bounded", () => {
    const html = renderToStaticMarkup(<ReviewFooter {...props("")} />);
    expect(html).toContain("Directions for the author (optional)");
    expect(html).toContain(`maxLength="${maximumRevisionDirectionLength}"`);
    expect(html).toContain("not evidence");
    expect(html.indexOf("Directions for the author")).toBeLessThan(
      html.indexOf("Request revision"),
    );
    expect(html).not.toContain(`/${maximumRevisionDirectionLength}`);
  });

  it("shows the typed text and its length against the bound", () => {
    const html = renderToStaticMarkup(<ReviewFooter {...props("Lead with tokenisation")} />);
    expect(html).toContain("Lead with tokenisation");
    expect(html).toContain(`22/${maximumRevisionDirectionLength}`);
  });
});

describe("sending the directions", () => {
  it("sends the trimmed text with the request and clears the field after", () => {
    const calls: string[] = [];
    const sent: ReviewAction[] = [];
    sendRevisionRequest(
      "  Lead with tokenisation.  ",
      (action) => {
        calls.push("send");
        sent.push(action);
      },
      () => calls.push("clear"),
    );
    expect(sent).toEqual([
      { type: "request-revision", candidateDirection: "Lead with tokenisation." },
    ]);
    expect(calls).toEqual(["send", "clear"]);
  });

  it("sends a plain request when the field is blank", () => {
    expect(requestRevisionAction("   ")).toEqual({ type: "request-revision" });
    const clear = vi.fn();
    const send = vi.fn();
    sendRevisionRequest("", send, clear);
    expect(send).toHaveBeenCalledWith({ type: "request-revision" });
    expect(clear).toHaveBeenCalledOnce();
  });
});

describe("directions for a run on an older author prompt", () => {
  const textarea = /<textarea class="revision-direction-input"[^>]*>/u;
  const footer = (unavailable: boolean | undefined) =>
    renderToStaticMarkup(
      <ReviewFooter
        {...({
          blocker: { tone: "safe", text: "Ready" },
          readOnly: false,
          errorMessage: null,
          statusLine: "",
          detail: null,
          conditions: [],
          editNote: null,
          detailsOpen: false,
          onDetailsOpenChange: noop,
          recovery: null,
          approve: { disabled: true, onApprove: noop },
          override: null,
          revision: {
            disabled: false,
            onRequest: noop,
            direction: "",
            onDirectionChange: noop,
            ...(unavailable === undefined ? {} : { directionsUnavailable: unavailable }),
          },
          exportAction: {
            disabled: true,
            pathLabel: "",
            again: false,
            pendingSeconds: null,
            onExport: noop,
          },
        } as unknown as ReviewFooterProps)}
      />,
    );

  it("disables the field with the note when the prompt cannot take directions", () => {
    const html = footer(true);
    expect(html.match(textarea)?.[0]).toContain('disabled=""');
    expect(html).toContain(revisionDirectionsUnavailableNote);
    expect(revisionDirectionsUnavailableNote).toBe(
      "Directions need a review started with the current author prompt. Start a new review to use them.",
    );
  });

  it("keeps the field enabled when the prompt can take directions or the host did not say", () => {
    for (const unavailable of [false, undefined]) {
      const html = footer(unavailable);
      expect(html.match(textarea)?.[0]).not.toContain("disabled");
      expect(html).not.toContain(revisionDirectionsUnavailableNote);
    }
  });

  const review = (authorDirections: boolean) =>
    renderToStaticMarkup(
      <ReviewWorkspace
        state={{
          ...createFixtureReviewState(),
          state: "awaiting-approval",
          round: 1,
          findings: [],
          runInputs: { brief: null, profile: null, authorDirections },
        }}
        onAction={noop}
      />,
    );

  it("wires the run's recorded prompt support into the review", () => {
    const v8 = review(false);
    expect(v8.match(textarea)?.[0]).toContain('disabled=""');
    expect(v8).toContain(revisionDirectionsUnavailableNote);
    const v9 = review(true);
    expect(v9.match(textarea)?.[0]).not.toContain("disabled");
    expect(v9).not.toContain(revisionDirectionsUnavailableNote);
  });

  /* Drift proof: the field crosses the real review-state validator. */
  it("crosses the bridge as a boolean and nothing else", async () => {
    const load = (authorDirections: unknown) =>
      createCapabilityPort({
        capabilities: ["review.load"],
        invoke: async () =>
          ({
            ok: true,
            value: {
              ...createFixtureReviewState(),
              runInputs: { brief: null, profile: null, authorDirections },
            },
          }) as never,
      }).execute({ type: "review.load", input: {} });
    await expect(load(false)).resolves.toMatchObject({
      ok: true,
      value: { runInputs: { authorDirections: false } },
    });
    await expect(load("no")).resolves.toMatchObject({ ok: false });
  });
});
