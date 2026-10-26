import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationRunRowView } from "./application-run-list.js";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import type { ProviderRoutesView } from "./provider-routes.js";
import { ReviewWorkspace } from "./review.js";
import {
  apiKeyRouteLabel,
  chosenRawJobDescriptionValue,
  jobTextRequirementsValue,
  modelProfileTier,
  StartConfirmation,
  type StartReviewAction,
  startConfirmationHandlers,
  startConfirmationSummary,
  startModelPreset,
} from "./start-confirmation.js";

const sessions: ProviderRoutesView = {
  anthropic: "user-session",
  openai: "user-session",
  sessionCallLimitMs: 600_000,
};

function liveState(overrides: Partial<DesktopReviewState> = {}): DesktopReviewState {
  const fixture = createFixtureReviewState();
  return {
    ...fixture,
    providerRoutes: sessions,
    ...overrides,
    setup: { ...fixture.setup, autopilot: true, ...overrides.setup, fixtureMode: false },
  };
}

function row(overrides: Partial<ApplicationRunRowView>): ApplicationRunRowView {
  return {
    runId: "run-1",
    startedAt: "2026-10-14T10:00:00.000Z",
    authorModel: "claude-sonnet-4-5",
    criticModel: "gpt-5",
    round: 2,
    state: "awaiting-approval",
    latest: true,
    ...overrides,
  };
}

const start: StartReviewAction = { type: "start" };

describe("start confirmation summary", () => {
  it("names each role's company, model and session route", () => {
    const summary = startConfirmationSummary(liveState(), { action: start });
    expect(summary.models).toEqual([
      {
        role: "Author",
        company: "Anthropic",
        model: "claude-sonnet-4-5",
        tier: null,
        route: "Claude session",
      },
      { role: "Critic", company: "OpenAI", model: "gpt-5", tier: null, route: "ChatGPT session" },
    ]);
    expect(summary.sameCompanyWarning).toBeNull();
  });

  it("labels the API-key route as billed per token", () => {
    const summary = startConfirmationSummary(
      liveState({ providerRoutes: { ...sessions, openai: "api-key" } }),
      { action: start },
    );
    expect(summary.models[0].route).toBe("Claude session");
    expect(summary.models[1].route).toBe(apiKeyRouteLabel);
    expect(apiKeyRouteLabel).toBe("API key, billed per token");
  });

  it("omits the route when the host did not report one", () => {
    const { providerRoutes: _omitted, ...withoutRoutes } = liveState();
    const summary = startConfirmationSummary(withoutRoutes, { action: start });
    expect(summary.models.map((model) => model.route)).toEqual([null, null]);
    expect(summary.settings.map((line) => line.label)).not.toContain("Call limit");
  });

  it("warns when author and critic come from the same company", () => {
    const fixture = liveState();
    const preflight = fixture.providerTransmissionPreflight;
    const summary = startConfirmationSummary(
      liveState({
        providerTransmissionPreflight: {
          ...preflight,
          critic: { ...preflight.critic, company: "anthropic", model: "claude-opus-5-5" },
        },
      }),
      { action: start },
    );
    expect(summary.sameCompanyWarning).toBe(
      "Author and critic are both from Anthropic, so the critique is not a cross-company check.",
    );
  });

  it("notes the last run's pair only when it differs from the pair about to run", () => {
    const differs = startConfirmationSummary(
      liveState({
        applicationRuns: [row({ authorModel: "claude-opus-4-1", criticModel: "gpt-5-mini" })],
      }),
      { action: start },
    );
    expect(differs.changedPairNote).toBe(
      "The last run on this application used claude-opus-4-1 → gpt-5-mini.",
    );
    const same = startConfirmationSummary(liveState({ applicationRuns: [row({})] }), {
      action: start,
    });
    expect(same.changedPairNote).toBeNull();
    const none = startConfirmationSummary(liveState(), { action: start });
    expect(none.changedPairNote).toBeNull();
    const unrecorded = startConfirmationSummary(
      liveState({ applicationRuns: [row({ authorModel: "", criticModel: "" })] }),
      { action: start },
    );
    expect(unrecorded.changedPairNote).toBeNull();
  });

  it("uses the latest row, not an older one, for the last pair", () => {
    const summary = startConfirmationSummary(
      liveState({
        applicationRuns: [
          row({ runId: "run-old", latest: false, authorModel: "old-author" }),
          row({ runId: "run-new", latest: true }),
        ],
      }),
      { action: start },
    );
    expect(summary.changedPairNote).toBeNull();
  });

  it("shows the per-call limit only on the session route", () => {
    const limit = (routes: ProviderRoutesView) =>
      startConfirmationSummary(liveState({ providerRoutes: routes }), {
        action: start,
      }).settings.find((line) => line.label === "Call limit")?.value;
    expect(limit(sessions)).toBe("10 min per call");
    expect(limit({ ...sessions, openai: "api-key" })).toBe("10 min per call for the author");
    expect(limit({ ...sessions, anthropic: "api-key" })).toBe("10 min per call for the critic");
    expect(limit({ ...sessions, anthropic: "api-key", openai: "api-key" })).toBeUndefined();
  });

  it("says a demo workspace makes no provider call and has no call limit", () => {
    const fixture = createFixtureReviewState();
    const summary = startConfirmationSummary(
      { ...fixture, providerRoutes: sessions },
      { action: start },
    );
    expect(summary.models.map((model) => model.route)).toEqual([
      "Demo, no provider call",
      "Demo, no provider call",
    ]);
    expect(summary.settings.map((line) => line.label)).not.toContain("Call limit");
  });

  it("lists the requirements source, profile and writing policy", () => {
    const state = liveState({
      setup: {
        ...createFixtureReviewState().setup,
        writingPolicyStatus: "active",
        writingPolicy: {
          checksum: "a".repeat(64),
          version: "policy-v2",
          schemaVersion: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
          priorChecksum: null,
        },
        reviewedOpportunity: { briefId: "brief-1", version: 3 },
      },
    });
    const reviewed = startConfirmationSummary(state, {
      action: start,
      reviewedRequirements: {
        briefId: "brief-1",
        version: 3,
        requirementCount: 18,
        criticalCount: 4,
      },
      candidateProfile: { version: 4 },
    });
    expect(reviewed.inputs).toEqual([
      { label: "Requirements", value: "Reviewed brief v3 · 18 requirements" },
      { label: "Career profile", value: "v4" },
      { label: "Writing policy", value: "Active, policy-v2" },
    ]);
    const unresolved = startConfirmationSummary(state, { action: start });
    expect(unresolved.inputs[0]).toEqual({ label: "Requirements", value: "Reviewed brief v3" });
    expect(unresolved.inputs.map((line) => line.label)).not.toContain("Career profile");
    const raw = startConfirmationSummary(liveState(), {
      action: { type: "start", requirementsSource: "job-description" },
      reviewedRequirements: {
        briefId: "brief-1",
        version: 3,
        requirementCount: 18,
        criticalCount: 4,
      },
      candidateProfile: null,
    });
    expect(raw.inputs).toEqual([
      { label: "Requirements", value: chosenRawJobDescriptionValue },
      { label: "Career profile", value: "None pinned" },
      { label: "Writing policy", value: "None" },
    ]);
    const noBrief = startConfirmationSummary(
      liveState({ setup: { ...liveState().setup, reviewedOpportunity: null } }),
      { action: start, reviewedRequirements: null },
    );
    expect(noBrief.inputs[0]).toEqual({ label: "Requirements", value: jobTextRequirementsValue });
  });

  it("lists autopilot and the round limit", () => {
    const summary = startConfirmationSummary(liveState(), { action: start });
    expect(summary.settings.slice(0, 2)).toEqual([
      { label: "Autopilot", value: "On" },
      { label: "Round limit", value: "2 rounds" },
    ]);
  });
});

describe("start confirmation dialog", () => {
  const render = (changeModels?: boolean) =>
    renderToStaticMarkup(
      <StartConfirmation
        summary={startConfirmationSummary(
          liveState({ applicationRuns: [row({ authorModel: "claude-opus-4-1" })] }),
          { action: start },
        )}
        dialogRef={createRef<HTMLDivElement>()}
        onStart={() => undefined}
        onCancel={() => undefined}
        {...(changeModels === true
          ? {
              changeModelsAction: (
                <button className="button button-toolbar" type="button">
                  Change models
                </button>
              ),
            }
          : {})}
      />,
    );

  it("renders a labelled modal with the models, inputs and run settings", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Start this review?");
    expect(html).toContain("Anthropic · claude-sonnet-4-5 · Claude session");
    expect(html).toContain("OpenAI · gpt-5 · ChatGPT session");
    expect(html).toContain("The last run on this application used claude-opus-4-1 → gpt-5.");
    expect(html).toContain("Run settings");
    expect(html).toContain("10 min per call");
  });

  it("puts Start first so it takes the focus, then Change models and Cancel", () => {
    const html = render(true);
    const startAt = html.indexOf(">Start</button>");
    const changeAt = html.indexOf(">Change models</button>");
    const cancelAt = html.indexOf(">Cancel</button>");
    expect(startAt).toBeGreaterThan(-1);
    expect(startAt).toBeLessThan(changeAt);
    expect(changeAt).toBeLessThan(cancelAt);
    expect(render(false)).not.toContain("Change models");
  });

  it("is not open until a Start trigger asks for it", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={liveState()} onAction={() => undefined} />,
    );
    expect(html).not.toContain("Start this review?");
  });
});

describe("model profile tier and career profile", () => {
  it("names the tier from the profile id prefix and omits it when unknown", () => {
    expect(modelProfileTier("economy-anthropic-author")).toBe("Economy");
    expect(modelProfileTier("balanced-openai-critic")).toBe("Balanced");
    expect(modelProfileTier("standard-anthropic-author")).toBe("Standard");
    expect(modelProfileTier("premium-openai-critic")).toBe("Premium");
    expect(modelProfileTier("dev-local-author")).toBe("Development");
    expect(modelProfileTier("custom-anthropic-author")).toBeNull();
    expect(modelProfileTier(undefined)).toBeNull();
  });

  it("puts each role's tier in its model line", () => {
    const summary = startConfirmationSummary(liveState(), {
      action: start,
      modelProfiles: { author: { id: "standard-anthropic-author" }, critic: { id: "custom-x" } },
    });
    expect(summary.models.map((model) => model.tier)).toEqual(["Standard", null]);
  });

  it.each([
    ["economy-anthropic-author", 2, "economy-openai-critic", 1, "Economy"],
    ["economy-anthropic-author", 1, "standard-openai-critic", 2, "Balanced"],
    ["standard-anthropic-author", 1, "standard-openai-critic", 2, "Standard"],
  ])(
    "names the %s@%i and %s@%i pair as the %s preset, once, with no tier per model",
    (authorId, authorVersion, criticId, criticVersion, preset) => {
      const modelProfiles = {
        author: { id: authorId, version: authorVersion },
        critic: { id: criticId, version: criticVersion },
      };
      const summary = startConfirmationSummary(liveState(), { action: start, modelProfiles });
      expect(summary.preset).toBe(preset);
      expect(summary.models.map((model) => model.tier)).toEqual([null, null]);
      const html = renderToStaticMarkup(
        <StartConfirmation
          summary={summary}
          dialogRef={createRef<HTMLDivElement>()}
          onStart={() => undefined}
          onCancel={() => undefined}
        />,
      );
      expect(html).toContain(`<dt>Preset</dt><dd>${preset}</dd>`);
      expect(html).toContain("Anthropic · claude-sonnet-4-5 · Claude session");
    },
  );

  it("keeps the tier per model for a pair no preset covers, or an unknown version", () => {
    expect(
      startModelPreset({
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "economy-openai-critic", version: 1 },
      }),
    ).toBeNull();
    expect(
      startModelPreset({
        author: { id: "economy-anthropic-author" },
        critic: { id: "standard-openai-critic" },
      }),
    ).toBeNull();
    const summary = startConfirmationSummary(liveState(), {
      action: start,
      modelProfiles: {
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
    });
    expect(summary.preset).toBeNull();
    expect(summary.models.map((model) => model.tier)).toEqual(["Standard", "Economy"]);
  });

  it("shows the career profile version or that none is pinned, only when given", () => {
    const line = (candidateProfile?: { version: number } | null) =>
      startConfirmationSummary(liveState(), {
        action: start,
        ...(candidateProfile === undefined ? {} : { candidateProfile }),
      }).inputs.find((input) => input.label === "Career profile")?.value;
    expect(line({ version: 4 })).toBe("v4");
    expect(line(null)).toBe("None pinned");
    expect(line()).toBeUndefined();
  });

  it("shows both in the review screen's confirmation markup", () => {
    const html = renderToStaticMarkup(
      <StartConfirmation
        summary={startConfirmationSummary(liveState(), {
          action: start,
          candidateProfile: { version: 4 },
          modelProfiles: {
            author: { id: "standard-anthropic-author" },
            critic: { id: "premium-openai-critic" },
          },
        })}
        dialogRef={createRef<HTMLDivElement>()}
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain("Anthropic · claude-sonnet-4-5 · Standard · Claude session");
    expect(html).toContain("OpenAI · gpt-5 · Premium · ChatGPT session");
    expect(html).toContain("<dt>Career profile</dt><dd>v4</dd>");
  });

  it("accepts both props on the review screen without opening the check", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={liveState()}
        onAction={() => undefined}
        startCandidateProfile={{ version: 4 }}
        startModelProfiles={{ author: { id: "standard-anthropic-author" } }}
      />,
    );
    expect(html).not.toContain("Start this review?");
  });
});

describe("start confirmation handlers", () => {
  it("Start closes the check and dispatches the trigger's own action unchanged", () => {
    const action: StartReviewAction = { type: "start", requirementsSource: "job-description" };
    const dispatch = vi.fn();
    const close = vi.fn();
    startConfirmationHandlers(action, dispatch, close).onStart();
    expect(close).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0]).toBe(action);
  });

  it("Start adds the chosen length as a page target, and leaves it out for the policy's own", () => {
    const dispatch = vi.fn();
    const handlers = startConfirmationHandlers(start, dispatch, () => undefined);
    handlers.onStart("one-page");
    handlers.onStart("policy");
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ ...start, pageTarget: "one-page" });
    expect(dispatch.mock.calls[1]?.[0]).toBe(start);
  });

  it("offers the length with the writing policy's own target selected", () => {
    const html = renderToStaticMarkup(
      <StartConfirmation
        summary={startConfirmationSummary(liveState(), { action: start })}
        dialogRef={createRef<HTMLDivElement>()}
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain("<legend>Length</legend>");
    expect(html).toContain('checked="" value="policy"');
    expect(html).toContain("One page");
    expect(html).toContain("Two pages");
    expect(html).toContain("saved as your writing policy&#x27;s page target");
  });

  it("Cancel closes the check and dispatches nothing", () => {
    const dispatch = vi.fn();
    const close = vi.fn();
    startConfirmationHandlers(start, dispatch, close).onCancel();
    expect(close).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

/*
 * A real payload goes through the real review-state validator, so the routes the host sends reach
 * the renderer unchanged; this fails when "providerRoutes" is missing from the bridge allowlist.
 */
describe("provider routes over the bridge", () => {
  const load = (state: unknown) => {
    const bridge: NativeBridge = {
      capabilities: ["review.load"],
      invoke: async () => ({ ok: true, value: state }) as never,
    };
    return createCapabilityPort(bridge).execute({
      type: "review.load",
      input: { workspaceId: "workspace-demo" },
    });
  };

  it("accepts a real payload with the routes unchanged", async () => {
    const result = await load(liveState({ providerRoutes: { ...sessions, openai: "api-key" } }));
    expect(result).toMatchObject({
      ok: true,
      value: {
        providerRoutes: {
          anthropic: "user-session",
          openai: "api-key",
          sessionCallLimitMs: 600_000,
        },
      },
    });
  });

  it("rejects an unknown route or an extra key", async () => {
    const unknown = await load(
      liveState({ providerRoutes: { ...sessions, openai: "browser" } as never }),
    );
    expect(unknown.ok).toBe(false);
    const extra = await load(
      liveState({ providerRoutes: { ...sessions, mistral: "api-key" } as never }),
    );
    expect(extra.ok).toBe(false);
  });
});
