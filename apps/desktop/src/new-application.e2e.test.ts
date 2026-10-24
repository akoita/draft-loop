import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
} from "@draft-loop/application";
import { bridgeCapabilities } from "@draft-loop/ui/bridge-capabilities";
import type { DesktopReviewState } from "@draft-loop/ui/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationStepStates } from "./application-steps-model.js";
import { createNativeHost } from "./electron/host.js";
import { runJobRequirementsExtraction } from "./job-requirements-extraction.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { submitNewApplication } from "./new-application-form.js";
import {
  defaultReviewedProfile,
  emptyNewApplicationDraft,
  loadReviewedProfileChoices,
} from "./new-application-model.js";
import { candidateProfileStartBlockerMessage, startChecklist } from "./start-checklist-model.js";

/*
 * Home's New application form and the application screen's three steps, driven through their
 * real models and port against the real native host. Only the model providers and the run itself
 * are stubbed.
 */

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-new-application-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

function reviewedProfileRecord(workspaceId: string): never {
  const at = "2026-10-05T10:00:00.000Z";
  return {
    workspaceId,
    checksum: "e".repeat(64),
    profile: {
      schemaVersion: 1,
      id: "candidate-profile",
      version: 1,
      parentVersion: null,
      status: "reviewed",
      createdAt: at,
      updatedAt: at,
      reviewedAt: at,
      candidateKnowledgeSelection: { storeRoot: "/private/selection-root" },
      facts: [
        {
          id: "fact-link",
          category: "approved-link",
          field: "url",
          value: "https://approved.example.test/me",
          provenance: [
            {
              storeId: "store-native",
              knowledgeBaseId: "knowledge-native",
              sourceId: "source-native",
              versionId: "version-native",
              kind: "candidate-provided",
            },
          ],
        },
      ],
      issues: [],
    },
  } as never;
}

async function openFlowHost() {
  const real = createApplicationService(createLocalApplicationDriver({}));
  let workspaceId = "";
  const begin = vi.fn<ApplicationService["begin"]>(async () => {
    throw new Error("the run is observed, not started");
  });
  const derive = vi.fn<ApplicationService["deriveCanonicalCandidateProfile"]>();
  const extractions: Parameters<ApplicationService["createOpportunity"]>[0][] = [];
  const host = createNativeHost({
    applicationService: {
      ...real,
      begin,
      deriveCanonicalCandidateProfile: derive,
      listCanonicalCandidateProfileVersions: async () => [reviewedProfileRecord(workspaceId)],
      createOpportunity: async (command) => {
        extractions.push(command);
        return real.createOpportunity({
          root: command.root,
          sources: [
            {
              id: "posting",
              kind: "pasted-content",
              classification: "job-posting",
              content: "# Platform Engineer\n\n## Requirements\n\n- Kubernetes\n",
            },
          ],
          ...(command.applicationId === undefined ? {} : { applicationId: command.applicationId }),
        });
      },
    },
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "real" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  const port = createBridgeReviewPort(
    createNativeCapabilityPort({
      capabilities: [...bridgeCapabilities],
      invoke: (command) => host.invoke(command) as never,
    }),
  );
  return { port, workspaceId, begin, derive, extractions };
}

type Flow = Awaited<ReturnType<typeof openFlowHost>>;

/** The step the application screen opens at, from the loaded state as the screen derives it. */
function currentStep(
  state: DesktopReviewState,
  candidateProfile: { readonly version: number } | null,
) {
  const steps = applicationStepStates(
    startChecklist({
      setup: state.setup,
      startFromJobDescription: false,
      requirementAction: null,
      candidateProfile,
      transmission: state.providerTransmissionPreflight,
      // The screen holds Start until a reviewed profile is selected.
      startDisabledReason: candidateProfile === null ? candidateProfileStartBlockerMessage : null,
      canOpenProviderSignIn: false,
    }),
  );
  return steps.find((step) => step.status.kind === "current")?.id;
}

/** One application from Home's form to its first review, in the order of the screen's steps. */
async function runFlow(flow: Flow, name: string, jobText: string) {
  const { port, workspaceId } = flow;
  const createApplication = port.createApplication;
  if (createApplication === undefined) throw new Error("The host offers no applications.");
  const profiles = await loadReviewedProfileChoices(port, workspaceId);
  if (profiles.status !== "ready") throw new Error(`Expected profiles: ${profiles.status}`);
  const chosen = defaultReviewedProfile(profiles.choices);
  if (chosen === undefined) throw new Error("Expected a reviewed profile.");
  const profile = { profileId: chosen.profileId, version: chosen.version };

  // Home's form: a name and the job, then the application opens.
  const created = await submitNewApplication(
    { ...emptyNewApplicationDraft, name: `  ${name} `, jobText },
    (applicationName, job) => createApplication(workspaceId, applicationName, job),
  );
  if (created.kind !== "created") throw new Error(`Expected creation: ${JSON.stringify(created)}`);
  const application = created.application;
  expect(application.name).toBe(name);
  port.selectApplication?.(application.id);
  const opened = await port.load();
  expect(opened.state).toBe("collecting");
  expect(await port.getLatestOpportunity?.()).toBeNull();
  // It opens at its first unfinished step. Pasted text already gives step 1 requirements to read,
  // so the profile is next until the latest reviewed one is selected.
  expect(currentStep(opened, null)).toBe("profile");

  // Step 1: extract with consent, then review the brief.
  const phase = await runJobRequirementsExtraction(
    port.createOpportunity ?? (() => Promise.reject(new Error("no extraction"))),
  );
  if (phase.kind !== "done") throw new Error(`Expected extraction: ${JSON.stringify(phase)}`);
  const draft = await port.getLatestOpportunity?.();
  expect(draft).toMatchObject({ briefId: phase.summary.briefId, status: "draft" });
  const edited = await port.editOpportunity?.({
    briefId: phase.summary.briefId,
    expectedVersion: phase.summary.version,
    patch: {
      role: { value: "Platform Engineer", sourceIds: ["posting"] },
      employer: { value: name, sourceIds: ["posting"] },
      requirements: [
        { id: "requirement-1", text: "Kubernetes", priority: "high", sourceIds: ["posting"] },
      ],
    },
  });
  const reviewed = await port.reviewOpportunity?.(phase.summary.briefId, edited?.version ?? 0);
  const latest = await port.getLatestOpportunity?.();
  expect(latest).toMatchObject({ briefId: phase.summary.briefId, status: "reviewed" });

  // Reopened, it resumes at its first unfinished step: the profile, or the review once the
  // latest reviewed profile is selected without generating anything.
  const state = await port.load();
  expect(currentStep(state, null)).toBe("profile");
  expect(currentStep(state, profile)).toBe("review");

  // Step 3: acknowledge the provider transmission, then start the review.
  const preflight = state.providerTransmissionPreflight;
  const acknowledged =
    preflight.required && !preflight.acknowledged
      ? await port.dispatch(state, {
          type: "acknowledge-provider-transmission",
          fingerprint: preflight.fingerprint,
        })
      : state;
  expect(acknowledged.setup.reviewedOpportunity).toEqual({
    briefId: phase.summary.briefId,
    version: reviewed?.version,
  });
  await port
    .dispatch(acknowledged, { type: "start", candidateProfile: profile })
    .catch(() => undefined);
  return { application, briefId: phase.summary.briefId, version: reviewed?.version, profile };
}

describe("a new application, end to end", () => {
  it("creates an application, opens it at its first unfinished step and starts a bound run", async () => {
    const flow = await openFlowHost();

    const first = await runFlow(
      flow,
      "Acme",
      "# Platform Engineer\n\nBuild tools with Kubernetes.",
    );

    expect(flow.extractions).toHaveLength(1);
    expect(flow.extractions[0]).toMatchObject({
      applicationId: first.application.id,
      allowProviderData: true,
    });
    expect(flow.begin).toHaveBeenCalledTimes(1);
    expect(flow.begin.mock.calls[0]?.[0]).toMatchObject({
      applicationId: first.application.id,
      opportunityBrief: { briefId: first.briefId, version: first.version },
      candidateProfile: first.profile,
    });
  });

  it("opens an application from an approved job page at step 1, fetching nothing yet", async () => {
    const flow = await openFlowHost();
    const createApplication = flow.port.createApplication;
    if (createApplication === undefined) throw new Error("The host offers no applications.");
    const created = await submitNewApplication(
      {
        ...emptyNewApplicationDraft,
        name: "Gamma",
        jobKind: "url",
        jobUrl: "https://jobs.example.test/platform",
        urlApproved: true,
      },
      (name, job) => createApplication(flow.workspaceId, name, job),
    );
    if (created.kind !== "created")
      throw new Error(`Expected creation: ${JSON.stringify(created)}`);
    expect(created.application.jobSourceKind).toBe("approved-url");
    flow.port.selectApplication?.(created.application.id);
    const opened = await flow.port.load();
    expect(currentStep(opened, { version: 1 })).toBe("job");
    expect(flow.extractions).toHaveLength(0);
  });

  it("starts a second application with its own brief and the same profile, regenerating nothing", async () => {
    const flow = await openFlowHost();

    const first = await runFlow(
      flow,
      "Acme",
      "# Platform Engineer\n\nBuild tools with Kubernetes.",
    );
    const second = await runFlow(flow, "Beta", "# Data Engineer\n\nBuild pipelines with Spark.");

    expect(second.application.id).not.toBe(first.application.id);
    expect(second.briefId).not.toBe(first.briefId);
    expect(second.profile).toEqual(first.profile);
    expect(flow.derive).not.toHaveBeenCalled();
    expect(flow.begin).toHaveBeenCalledTimes(2);
    expect(flow.begin.mock.calls[1]?.[0]).toMatchObject({
      applicationId: second.application.id,
      opportunityBrief: { briefId: second.briefId, version: second.version },
      candidateProfile: first.profile,
    });

    // The first application still has only its own brief.
    flow.port.selectApplication?.(first.application.id);
    expect(await flow.port.getLatestOpportunity?.()).toMatchObject({ briefId: first.briefId });
    const applications = await flow.port.listApplications?.(flow.workspaceId);
    const counts = new Map(applications?.map((item) => [item.id, item.briefCount]));
    expect(counts.get(first.application.id)).toBe(1);
    expect(counts.get(second.application.id)).toBe(1);
    expect(counts.get("default")).toBe(0);
  });
});
