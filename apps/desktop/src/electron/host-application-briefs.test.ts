import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
} from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummaryView } from "../application-contract.js";
import type { OpportunityLatestResult, OpportunityRecordResult } from "../bridge.js";
import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-application-briefs-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

const jobMarker = "Private-job-marker";
const jobText = `# Staff Platform Engineer\n\n${jobMarker}: Kubernetes and Go.\n`;

type CreateCommand = Parameters<ApplicationService["createOpportunity"]>[0];

/**
 * A host over the real application service, with extraction replaced by a local candidate-input
 * brief so no provider is called. The real service still binds the brief to its application.
 */
async function openHost() {
  const real = createApplicationService(createLocalApplicationDriver({}));
  const created: CreateCommand[] = [];
  const begin = vi.fn<ApplicationService["begin"]>(async () => {
    throw new Error("begin is observed, not run");
  });
  const host = createNativeHost({
    applicationService: {
      ...real,
      begin,
      createOpportunity: async (command) => {
        created.push(command);
        return real.createOpportunity({
          root: command.root,
          sources: [
            {
              id: "posting",
              kind: "pasted-content",
              classification: "job-posting",
              content: "# Staff Platform Engineer\n\n## Requirements\n\n- Kubernetes\n- Go\n",
            },
          ],
          ...(command.applicationId === undefined ? {} : { applicationId: command.applicationId }),
        });
      },
    },
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const workspace = await host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "real" },
  });
  if (!workspace.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(workspace)}`);
  const workspaceId = (workspace.value as { workspace: { id: string } }).workspace.id;
  return { host, workspaceId, root: join(parent, "workspace"), created, begin };
}

type Harness = Awaited<ReturnType<typeof openHost>>;

async function value<Result>(promise: Promise<{ ok: boolean }>): Promise<Result> {
  const result = (await promise) as { ok: boolean; value?: unknown; error?: unknown };
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result.value as Result;
}

async function createApplication(
  { host, workspaceId }: Harness,
  name: string,
  job: { jobText: string } | { jobUrl: string; jobUrlApproved: true } = { jobText },
) {
  const created = await value<{ application: ApplicationSummaryView }>(
    host.invoke({ type: "application.create", input: { workspaceId, name, ...job } }),
  );
  return created.application;
}

const jobSource = {
  id: "workspace-job-description",
  kind: "workspace-job-description",
  classification: "job-posting",
} as const;

function extract({ host, workspaceId }: Harness, applicationId?: string, approved = true) {
  return host.invoke({
    type: "opportunity.create",
    input: {
      workspaceId,
      sources: [jobSource],
      providerTransmissionApproved: approved,
      ...(applicationId === undefined ? {} : { applicationId }),
    },
  });
}

function latest({ host, workspaceId }: Harness, applicationId?: string) {
  return value<OpportunityLatestResult>(
    host.invoke({
      type: "opportunity.latest",
      input: { workspaceId, ...(applicationId === undefined ? {} : { applicationId }) },
    }),
  );
}

/** Completes the extracted draft the way a reviewer would, then reviews it. */
async function reviewBrief(harness: Harness, briefId: string, applicationId?: string) {
  const { host, workspaceId } = harness;
  const scope = applicationId === undefined ? {} : { applicationId };
  const edited = await value<OpportunityRecordResult>(
    host.invoke({
      type: "opportunity.edit",
      input: {
        workspaceId,
        briefId,
        expectedVersion: 1,
        patch: {
          role: { value: "Staff Platform Engineer", sourceIds: ["posting"] },
          employer: { value: "Acme", sourceIds: ["posting"] },
          requirements: [
            { id: "requirement-1", text: "Kubernetes", priority: "high", sourceIds: ["posting"] },
          ],
        },
        ...scope,
      },
    }),
  );
  return value<OpportunityRecordResult>(
    host.invoke({
      type: "opportunity.review",
      input: { workspaceId, briefId, expectedVersion: edited.version, ...scope },
    }),
  );
}

async function setup(harness: Harness, applicationId?: string) {
  const { host, workspaceId } = harness;
  const loaded = await value<DesktopReviewState>(
    host.invoke({
      type: "review.load",
      input: { workspaceId, ...(applicationId === undefined ? {} : { applicationId }) },
    }),
  );
  return loaded.setup;
}

async function start(harness: Harness, applicationId: string, candidateProfile?: object) {
  const { host, workspaceId } = harness;
  const loaded = await value<DesktopReviewState>(
    host.invoke({ type: "review.load", input: { workspaceId, applicationId } }),
  );
  const preflight = loaded.providerTransmissionPreflight;
  if (preflight.required && !preflight.acknowledged) {
    await host.invoke({
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: "pending",
        action: { type: "acknowledge-provider-transmission", fingerprint: preflight.fingerprint },
        applicationId,
      },
    });
  }
  await host.invoke({
    type: "review.dispatch",
    input: {
      workspaceId,
      runId: "pending",
      action: { type: "start", ...(candidateProfile === undefined ? {} : { candidateProfile }) },
      applicationId,
    },
  });
}

describe("application-scoped opportunity briefs", () => {
  it("extracts from the application's own job and binds the brief to it", async () => {
    const harness = await openHost();
    const application = await createApplication(harness, "Acme");

    const record = await value<OpportunityRecordResult>(extract(harness, application.id));

    expect(harness.created).toHaveLength(1);
    const command = harness.created[0];
    expect(command).toMatchObject({ applicationId: application.id, allowProviderData: true });
    const source = command?.sources[0];
    expect(source).toMatchObject({ kind: "local-file", classification: "job-posting" });
    const path = source !== undefined && "path" in source ? source.path : "";
    expect(path).toContain(join("applications", application.id, "job.md"));
    expect(await readFile(path, "utf8")).toContain(jobMarker);

    const applications = await value<{ applications: ApplicationSummaryView[] }>(
      harness.host.invoke({
        type: "application.list",
        input: { workspaceId: harness.workspaceId },
      }),
    );
    const byId = new Map(applications.applications.map((item) => [item.id, item]));
    expect(byId.get(application.id)?.briefCount).toBe(1);
    expect(byId.get("default")?.briefCount).toBe(0);
    expect(record.briefId).toBeTruthy();
  });

  it("keeps the latest brief per application and leaves the workspace's alone", async () => {
    const harness = await openHost();
    const first = await createApplication(harness, "Acme");
    const second = await createApplication(harness, "Beta");
    const record = await value<OpportunityRecordResult>(extract(harness, first.id));

    expect(await latest(harness, first.id)).toMatchObject({ briefId: record.briefId, version: 1 });
    expect(await latest(harness, second.id)).toBeNull();
    expect(await latest(harness)).toBeNull();
    expect(await latest(harness, "default")).toBeNull();
  });

  it("reviews a brief for its application only and starts that application from it", async () => {
    const harness = await openHost();
    const first = await createApplication(harness, "Acme");
    const second = await createApplication(harness, "Beta");
    const record = await value<OpportunityRecordResult>(extract(harness, first.id));

    expect((await setup(harness, first.id)).reviewedOpportunity).toBeNull();
    const reviewed = await reviewBrief(harness, record.briefId, first.id);
    expect((await setup(harness, first.id)).reviewedOpportunity).toEqual({
      briefId: record.briefId,
      version: reviewed.version,
    });
    expect((await setup(harness, second.id)).reviewedOpportunity).toBeNull();
    expect((await setup(harness)).reviewedOpportunity).toBeNull();
    expect(await latest(harness, first.id)).toMatchObject({ status: "reviewed" });

    await start(harness, first.id);
    await start(harness, second.id);
    expect(harness.begin).toHaveBeenCalledTimes(2);
    expect(harness.begin.mock.calls[0]?.[0]).toMatchObject({
      applicationId: first.id,
      opportunityBrief: { briefId: record.briefId, version: reviewed.version },
    });
    expect(harness.begin.mock.calls[1]?.[0]).toMatchObject({ applicationId: second.id });
    expect(harness.begin.mock.calls[1]?.[0]).not.toHaveProperty("opportunityBrief");
  });

  it("keeps the default application on the workspace's own reviewed brief", async () => {
    const harness = await openHost();
    const application = await createApplication(harness, "Acme");
    await writeFile(join(harness.root, "job.md"), jobText, "utf8");
    const record = await value<OpportunityRecordResult>(extract(harness));
    const reviewed = await reviewBrief(harness, record.briefId);

    expect(await latest(harness)).toMatchObject({ briefId: record.briefId, status: "reviewed" });
    expect((await setup(harness)).reviewedOpportunity).toEqual({
      briefId: record.briefId,
      version: reviewed.version,
    });
    expect(await latest(harness, application.id)).toBeNull();
    expect((await setup(harness, application.id)).reviewedOpportunity).toBeNull();
  });

  it("refuses to edit or review another application's brief", async () => {
    const harness = await openHost();
    const first = await createApplication(harness, "Acme");
    const second = await createApplication(harness, "Beta");
    const record = await value<OpportunityRecordResult>(extract(harness, first.id));

    const review = await harness.host.invoke({
      type: "opportunity.review",
      input: {
        workspaceId: harness.workspaceId,
        briefId: record.briefId,
        expectedVersion: 1,
        applicationId: second.id,
      },
    });
    expect(review).toMatchObject({ ok: false, error: { code: "not-found" } });
    const edit = await harness.host.invoke({
      type: "opportunity.edit",
      input: {
        workspaceId: harness.workspaceId,
        briefId: record.briefId,
        expectedVersion: 1,
        patch: { issues: [] },
        applicationId: second.id,
      },
    });
    expect(edit).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(
      await harness.host.invoke({
        type: "opportunity.create",
        input: {
          workspaceId: harness.workspaceId,
          sources: [jobSource],
          providerTransmissionApproved: true,
          applicationId: "app-missing",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("forgets a reviewed brief once it is edited", async () => {
    const harness = await openHost();
    const application = await createApplication(harness, "Acme");
    const record = await value<OpportunityRecordResult>(extract(harness, application.id));
    const reviewed = await reviewBrief(harness, record.briefId, application.id);

    await value(
      harness.host.invoke({
        type: "opportunity.edit",
        input: {
          workspaceId: harness.workspaceId,
          briefId: record.briefId,
          expectedVersion: reviewed.version,
          patch: { issues: [] },
          applicationId: application.id,
        },
      }),
    );

    expect((await setup(harness, application.id)).reviewedOpportunity).toBeNull();
    expect(await latest(harness, application.id)).toMatchObject({
      status: "draft",
      version: reviewed.version + 1,
    });
  });
});

describe("an application whose job is a URL", () => {
  const url = "https://jobs.example.test/postings/12345";

  it("is not ready until its brief is reviewed, and never exposes the URL", async () => {
    const harness = await openHost();
    const application = await createApplication(harness, "Acme", {
      jobUrl: url,
      jobUrlApproved: true,
    });
    expect(application.jobSourceKind).toBe("approved-url");

    const before = await setup(harness, application.id);
    expect(before.jobDescriptionReady).toBe(false);
    expect(before.ready).toBe(false);
    expect(before.nextSteps.join(" ")).toContain("Extract and review requirements");
    expect(before.nextSteps.join(" ")).not.toContain("Add a target job description");

    expect(await extract(harness, application.id, false)).toMatchObject({
      ok: false,
      error: { code: "permission-denied" },
    });
    const record = await value<OpportunityRecordResult>(extract(harness, application.id));
    const source = harness.created.at(-1)?.sources[0];
    expect(source).toMatchObject({ kind: "approved-url", url, approved: true });
    const reviewed = await reviewBrief(harness, record.briefId, application.id);

    const after = await setup(harness, application.id);
    expect(after.jobDescriptionReady).toBe(true);
    expect(after.reviewedOpportunity).toEqual({
      briefId: record.briefId,
      version: reviewed.version,
    });
    expect(JSON.stringify([before, after, record])).not.toContain(url);
  });

  it("refuses an unapproved URL or a job given twice", async () => {
    const harness = await openHost();
    const { host, workspaceId } = harness;
    for (const input of [
      { jobUrl: url },
      { jobUrl: url, jobUrlApproved: false },
      { jobUrl: url, jobUrlApproved: true, jobText },
      { jobText, jobUrlApproved: true },
      { jobUrl: "file:///etc/passwd", jobUrlApproved: true },
    ]) {
      const result = await host.invoke({
        type: "application.create",
        input: { workspaceId, name: "Acme", ...input },
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("a second application in the same workspace", () => {
  it("starts with the same reviewed profile and its own brief", async () => {
    const harness = await openHost();
    const first = await createApplication(harness, "Acme");
    const second = await createApplication(harness, "Beta");
    const profile = { profileId: "candidate", version: 3 };
    const firstBrief = await value<OpportunityRecordResult>(extract(harness, first.id));
    const secondBrief = await value<OpportunityRecordResult>(extract(harness, second.id));
    const firstReviewed = await reviewBrief(harness, firstBrief.briefId, first.id);
    const secondReviewed = await reviewBrief(harness, secondBrief.briefId, second.id);

    await start(harness, first.id, profile);
    await start(harness, second.id, profile);

    expect(firstBrief.briefId).not.toBe(secondBrief.briefId);
    const [firstStart, secondStart] = harness.begin.mock.calls.map((call) => call[0]);
    expect(firstStart).toMatchObject({
      applicationId: first.id,
      candidateProfile: profile,
      opportunityBrief: { briefId: firstBrief.briefId, version: firstReviewed.version },
    });
    expect(secondStart).toMatchObject({
      applicationId: second.id,
      candidateProfile: profile,
      opportunityBrief: { briefId: secondBrief.briefId, version: secondReviewed.version },
    });
  });
});
