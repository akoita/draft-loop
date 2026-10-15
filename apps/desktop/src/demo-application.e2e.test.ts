import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApplicationService, createLocalApplicationDriver } from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bridgeCapabilities } from "./bridge-capabilities.js";
import { createNativeHost } from "./electron/host.js";
import { runJobRequirementsExtraction } from "./job-requirements-extraction.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";
import { submitNewApplication } from "./new-application-form.js";
import {
  defaultReviewedProfile,
  emptyNewApplicationDraft,
  loadReviewedProfileChoices,
} from "./new-application-model.js";

/*
 * A demo workspace from career evidence to a started review, against the real native host and the
 * real local application driver. Nothing is stubbed: the demo's local fixtures generate the
 * profile, extract the requirements and run the review. Every provider route throws, so any
 * provider call fails the test.
 */

let parent: string;
let evidencePath: string;

const evidenceText =
  "# Synthetic Candidate\n\n- Built a local-first TypeScript review tool\n- Led deterministic test design\n";
const jobText =
  "# Platform Engineer\n\n## Requirements\n\n- Kubernetes operations\n- TypeScript services\n";

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-demo-application-"));
  evidencePath = join(parent, "synthetic-resume.md");
  await writeFile(evidencePath, evidenceText, "utf8");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

function forbidden(route: string) {
  return vi.fn(() => {
    throw new Error(`A demo workspace must not reach ${route}.`);
  });
}

async function openDemoHost() {
  const providerRoutes = {
    resolveCredential: forbidden("a provider credential"),
    anthropic: forbidden("Anthropic"),
    openai: forbidden("OpenAI"),
    anthropicSession: forbidden("an Anthropic session"),
    openaiSession: forbidden("an OpenAI session"),
  };
  const service = createApplicationService(
    createLocalApplicationDriver({
      resolveCredential: providerRoutes.resolveCredential as never,
      providerClientFactories: {
        anthropic: providerRoutes.anthropic as never,
        openai: providerRoutes.openai as never,
      },
      userSessionRunners: {
        anthropic: providerRoutes.anthropicSession as never,
        openai: providerRoutes.openaiSession as never,
      },
    }),
  );
  const host = createNativeHost({
    applicationService: service,
    defaultKnowledgeStoreRoot: join(parent, "app-data", "candidate-knowledge"),
    dialogs: {
      chooseDirectory: async () => parent,
      chooseFiles: async () => [],
      chooseKnowledgeSourceFile: async () => evidencePath,
    },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "demo", mode: "demo" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  const port = createBridgeReviewPort(
    createNativeCapabilityPort({
      capabilities: [...bridgeCapabilities],
      invoke: (command) => host.invoke(command) as never,
    }),
  );
  return { host, port, workspaceId, providerRoutes };
}

type DemoHost = Awaited<ReturnType<typeof openDemoHost>>;

async function invoke<T>(host: DemoHost["host"], command: unknown): Promise<T> {
  const result = await host.invoke(command as never);
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** Career evidence: the default base, one synthetic file, selected for the workspace. */
async function addSyntheticEvidence({ host, workspaceId }: DemoHost): Promise<void> {
  const base = await invoke<{ storeId: string; knowledgeBaseId: string }>(host, {
    type: "knowledge.ensure-default",
    input: { workspaceId },
  });
  await invoke(host, {
    type: "knowledge.import-file",
    input: {
      storeId: base.storeId,
      knowledgeBaseId: base.knowledgeBaseId,
      selection: "native-dialog",
    },
  });
  await invoke(host, {
    type: "knowledge.select",
    input: {
      workspaceId,
      entries: [{ storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId }],
    },
  });
}

/** Generate profile with the demo's approval, then review it. */
async function generateAndReviewProfile(
  { host, workspaceId }: DemoHost,
  /** Called before the edit and the review, so a test can move the wall clock. */
  beforeStep: () => void = () => undefined,
) {
  const derived = await invoke<{
    profileId: string;
    version: number;
    status: string;
    facts: readonly { value: string }[];
    issues: readonly { code: string; status: string }[];
  }>(host, {
    type: "profile.derive",
    input: { workspaceId, profileId: "demo-profile", providerTransmissionApproved: true },
  });
  expect(derived.status).toBe("draft");
  expect(derived.facts.map((fact) => fact.value).sort()).toEqual(
    [
      "Built a local-first TypeScript review tool",
      "Led deterministic test design",
      "Synthetic Candidate",
    ].sort(),
  );
  // The open issues are the derivation's own omission warnings; the person acknowledges them,
  // sending the whole profile back as the Career profile page does.
  expect(derived.issues.every((issue) => issue.code === "omission")).toBe(true);
  beforeStep();
  const acknowledged = await invoke<{ version: number }>(host, {
    type: "profile.edit",
    input: {
      workspaceId,
      profileId: derived.profileId,
      expectedVersion: derived.version,
      patch: {
        facts: derived.facts,
        issues: derived.issues.map((issue) => ({ ...issue, status: "acknowledged" })),
      },
    },
  });
  beforeStep();
  const reviewed = await invoke<{ status: string; version: number }>(host, {
    type: "profile.review",
    input: { workspaceId, profileId: derived.profileId, expectedVersion: acknowledged.version },
  });
  expect(reviewed.status).toBe("reviewed");
}

describe("a demo workspace, offline end to end", () => {
  it("reviews a profile although the wall clock steps back between its steps (#1299)", async () => {
    const demo = await openDemoHost();
    await addSyntheticEvidence(demo);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let now = Date.parse("2026-10-15T10:00:00.000Z");
      vi.setSystemTime(now);
      await generateAndReviewProfile(demo, () => {
        now -= 1_200;
        vi.setSystemTime(now);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds evidence, builds a profile, extracts requirements and starts a review with no provider", async () => {
    const demo = await openDemoHost();
    const { port, workspaceId } = demo;

    await addSyntheticEvidence(demo);
    await generateAndReviewProfile(demo);
    const profiles = await loadReviewedProfileChoices(port, workspaceId);
    if (profiles.status !== "ready") throw new Error(`Expected profiles: ${profiles.status}`);
    const chosen = defaultReviewedProfile(profiles.choices);
    if (chosen === undefined) throw new Error("Expected a reviewed profile.");
    const profile = { profileId: chosen.profileId, version: chosen.version };

    // A new application with pasted job text.
    const createApplication = port.createApplication;
    if (createApplication === undefined) throw new Error("The host offers no applications.");
    const created = await submitNewApplication(
      { ...emptyNewApplicationDraft, name: "Demo application", jobText },
      (name, job) => createApplication(workspaceId, name, job),
    );
    if (created.kind !== "created")
      throw new Error(`Expected creation: ${JSON.stringify(created)}`);
    port.selectApplication?.(created.application.id);
    const opened = await port.load();
    expect(opened.setup.fixtureMode).toBe(true);

    // Extract and review the requirements.
    const phase = await runJobRequirementsExtraction(
      port.createOpportunity ?? (() => Promise.reject(new Error("no extraction"))),
    );
    if (phase.kind !== "done") throw new Error(`Expected extraction: ${JSON.stringify(phase)}`);
    expect(phase.summary.requirementCount).toBe(2);
    const draft = await port.getOpportunity?.(phase.summary.briefId);
    expect(draft?.role?.value).toBe("Platform Engineer");
    expect(draft?.requirements.map((item) => item.text)).toEqual([
      "Kubernetes operations",
      "TypeScript services",
    ]);
    // The job text names no employer and the fixture invents none; the brief is reviewed as is.
    expect(draft?.employer).toBeNull();
    const reviewed = await port.reviewOpportunity?.(phase.summary.briefId, phase.summary.version);
    expect(reviewed).toMatchObject({ status: "reviewed", employer: null });

    // Start the review.
    const state = await port.load();
    expect(state.setup.reviewedOpportunity).toEqual({
      briefId: phase.summary.briefId,
      version: reviewed?.version,
    });
    const started = await port.dispatch(state, { type: "start", candidateProfile: profile });
    expect(started.runId).not.toBeNull();
    // The fixture author and critic finish the first round offline, with no provider.
    await vi.waitFor(
      async () => {
        const latest = await port.load();
        expect(latest.runId).toBe(started.runId);
        expect(latest.execution.status).not.toBe("running");
      },
      { timeout: 30_000, interval: 50 },
    );
    const finished = await port.load();
    expect(finished.state).toBe("awaiting-approval");

    // Home's card follows the run: its first draft awaits the candidate, so it is in review.
    const applications = await port.listApplications?.(workspaceId);
    const listed = applications?.find((item) => item.id === created.application.id);
    expect(listed).toMatchObject({
      status: "in-review",
      runCount: 1,
      latestRunId: started.runId,
    });

    for (const route of Object.values(demo.providerRoutes)) {
      expect(route).not.toHaveBeenCalled();
    }
  });
});
