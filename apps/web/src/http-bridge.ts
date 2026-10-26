import { deriveModelLineage } from "@draft-loop/domain";
import type { ApplicationSummaryView } from "@draft-loop/ui/application-contract";
import { maximumApplicationJobTextLength } from "@draft-loop/ui/application-job-contract";
import { chosenApplicationRun, newestApplicationRunId } from "@draft-loop/ui/application-run-order";
import type {
  BridgeCapability,
  BridgeCommand,
  BridgeErrorCode,
  BridgeResult,
  NativeBridge,
  OpportunityCreateSource,
  RunStatus,
} from "@draft-loop/ui/bridge";
import {
  projectLatestOpportunity,
  projectOpportunityRecord,
} from "@draft-loop/ui/opportunity-projection";

import { type ApiClient, ApiRequestError, type ApiSchemas, describeError } from "./api-client.js";
import { Refusal, refuse } from "./bridge-refusal.js";
import {
  createKnowledgeAnswers,
  hostedKnowledgeCapabilities,
  isKnowledgeCommand,
  type PickFile,
} from "./knowledge-bridge.js";
import {
  createProfileAnswers,
  hostedProfileCapabilities,
  isProfileCommand,
} from "./profile-bridge.js";
import { createReviewActions, type DownloadFile } from "./review-actions.js";
import { saveFile } from "./save-file.js";
import { ownerWorkspaceId, ownerWorkspaceName } from "./workspace-model.js";

/**
 * The commands the hosted service can serve today. Everything else the shared screens offer, such
 * as folders, recent workspaces, provider keys and local models, stays hidden by capability.
 */
export const hostedBridgeCapabilities = [
  "workspace.configure-models",
  "writing-policy.read",
  "writing-policy.save",
  "application.list",
  "application.get",
  "application.job",
  "application.create",
  "application.archive",
  "application.rename",
  "application.set-models",
  "application.choose-run",
  ...hostedKnowledgeCapabilities,
  "opportunity.create",
  "opportunity.get",
  "opportunity.list",
  "opportunity.latest",
  "opportunity.edit",
  "opportunity.review",
  ...hostedProfileCapabilities,
  "run.status",
  "run.start",
  "run.pause",
  "run.resume",
  "run.stop",
  "review.load",
  "review.dispatch",
  "models.list",
  "models.preview-independence",
  "models.profile-support",
] as const satisfies readonly BridgeCapability[];

export interface HttpBridgeOptions {
  readonly client: ApiClient;
  /**
   * Hears every refusal the API answers, with its own code, so the shell can show its plan,
   * consent and screening panels; the screens only get the port's code and the API's message.
   */
  readonly onRefusal?: (error: ApiRequestError) => void;
  /** A fresh key for each run start, so a retried request never begins a second run. */
  readonly idempotencyKey?: () => string;
  /**
   * The workspace a review load opens when it names none, as the desktop opens its active one;
   * the owner's workspace when unset.
   */
  readonly workspaceId?: string;
  /** Opens a file picker for a career evidence upload; the browser's own file input when unset. */
  readonly pickFile?: PickFile;
  /** Saves an exported document; the browser's download when unset. */
  readonly download?: DownloadFile;
}

/** The policy's text and identity, without the dates the editor does not show. */
const pick = ({ content, version, checksum }: ApiSchemas["WritingPolicy"]) => ({
  content,
  version,
  checksum,
});

const hostedCompany = (company: string): "anthropic" | "openai" =>
  company === "anthropic" || company === "openai"
    ? company
    : refuse("The hosted service runs Anthropic and OpenAI models only.");

function errorCode(status: number): BridgeErrorCode {
  if (status === 404) return "not-found";
  if (status === 401 || status === 403) return "permission-denied";
  return "operation-failed";
}

type Application = ApiSchemas["Application"];

/** The API's application in the screens' summary, ordered as the desktop host orders runs. */
export function applicationSummary(application: Application): ApplicationSummaryView {
  const chosenRun = chosenApplicationRun(application.runs, application.chosenRunId);
  return {
    id: application.id,
    name: application.name,
    jobSourceKind: application.jobSourceKind,
    status: application.status as ApplicationSummaryView["status"],
    isDefault: application.isDefault,
    ...(application.jobMissing ? { jobMissing: true } : {}),
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    runCount: application.runs.length,
    briefCount: application.briefs.length,
    exportCount: application.exportCount,
    latestRunId: newestApplicationRunId(application.runs),
    archivedAt: application.archivedAt,
    modelProfiles: application.modelProfiles,
    nameChosen: application.nameChosen,
    suggestedName: application.suggestedName,
    ...(chosenRun === undefined ? {} : { chosenRun }),
  };
}

/** Desktop and hosted runs share their states, except that queued work reads as drafting. */
function runStatus(workspaceId: string, run: ApiSchemas["Run"] | undefined): RunStatus {
  if (run === undefined) {
    return { workspaceId, runId: null, state: "collecting", round: 0, approval: "pending" };
  }
  const state = run.state === "collecting" || run.state === "ingesting" ? "drafting" : run.state;
  return {
    workspaceId,
    runId: run.runId,
    state: state as RunStatus["state"],
    round: run.round,
    approval: run.approval,
  };
}

/** The application's newest reviewed brief, the one a run starts from. */
function reviewedBrief(application: Application) {
  const reviewed = application.briefs
    .filter(({ status }) => status === "reviewed")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return reviewed === undefined
    ? undefined
    : { briefId: reviewed.briefId, version: reviewed.latestVersion };
}

/** Until the shared review reaches the web (sprint 1p), only a start goes through the screens. */

/** The API's own source kinds; a URL, a file or a job file needs the desktop. */
function hostedSource(source: OpportunityCreateSource) {
  if (source.kind === "pasted-content" || source.kind === "candidate-input") return source;
  return refuse("The hosted service takes a job as pasted text only.");
}

/**
 * The shared screens' commands over the hosted API (ADR 0011, D9). It answers in the desktop
 * host's shapes, and `createCapabilityPort` runs every answer through the same exact-key
 * normalizers as the desktop's, so the screens cannot tell the hosts apart.
 */
export function createHttpBridge(options: HttpBridgeOptions): NativeBridge {
  const { client } = options;
  const idempotencyKey = options.idempotencyKey ?? (() => globalThis.crypto.randomUUID());
  const answerKnowledge = createKnowledgeAnswers(client, options.pickFile);
  const answerProfile = createProfileAnswers(client);
  const reviewAction = createReviewActions(client, idempotencyKey, options.download ?? saveFile);

  /** The run as the server projects it, with the owner token's fixed workspace named in words. */
  const reviewState = async (
    workspaceId: string,
    query: { readonly applicationId?: string; readonly runId?: string },
  ) => {
    const state = await client.call("GET /v1/workspaces/{workspaceId}/review-state", {
      path: { workspaceId },
      query,
    });
    return workspaceId === ownerWorkspaceId
      ? { ...state, workspaceName: ownerWorkspaceName }
      : state;
  };
  const applications = async (workspaceId: string) =>
    (await client.call("GET /v1/workspaces/{workspaceId}/applications", { path: { workspaceId } }))
      .applications;
  const application = (workspaceId: string, applicationId: string) =>
    client.call("GET /v1/workspaces/{workspaceId}/applications/{applicationId}", {
      path: { workspaceId, applicationId },
    });
  /** The named application, or the workspace's default one. */
  const scopedApplication = async (workspaceId: string, applicationId: string | undefined) => {
    if (applicationId !== undefined) return application(workspaceId, applicationId);
    const fallback = (await applications(workspaceId)).find(({ isDefault }) => isDefault);
    return fallback ?? refuse("The workspace has no default application.");
  };
  const brief = (workspaceId: string, briefId: string, version?: number) =>
    client.call("GET /v1/workspaces/{workspaceId}/opportunities/{briefId}", {
      path: { workspaceId, briefId },
      ...(version === undefined ? {} : { query: { version } }),
    });
  const record = (workspaceId: string, application: Application) => ({
    workspaceId,
    application: applicationSummary(application),
  });
  const run = (workspaceId: string, runId: string) =>
    client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
      path: { workspaceId, runId },
    });

  async function answer(command: BridgeCommand): Promise<unknown> {
    if (isKnowledgeCommand(command)) return answerKnowledge(command);
    if (isProfileCommand(command)) return answerProfile(command);
    switch (command.type) {
      case "application.list": {
        const { workspaceId } = command.input;
        return {
          workspaceId,
          applications: (await applications(workspaceId)).map(applicationSummary),
        };
      }
      case "application.get": {
        const { workspaceId, applicationId } = command.input;
        return record(workspaceId, await application(workspaceId, applicationId));
      }
      case "application.job": {
        const { workspaceId } = command.input;
        const scoped = await scopedApplication(workspaceId, command.input.applicationId);
        const job = await client.call(
          "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/job",
          { path: { workspaceId, applicationId: scoped.id } },
        );
        const truncated = job.text !== null && job.text.length > maximumApplicationJobTextLength;
        return {
          workspaceId,
          origin: job.origin,
          text: truncated ? job.text?.slice(0, maximumApplicationJobTextLength) : job.text,
          truncated,
          url: job.url,
        };
      }
      case "application.create": {
        const { workspaceId, name, jobText } = command.input;
        if (command.input.jobUrl !== undefined) {
          return refuse("The hosted service takes a job as pasted text only.");
        }
        if (jobText === undefined) return refuse("Paste the job description first.");
        const created = await client.call("POST /v1/workspaces/{workspaceId}/applications", {
          path: { workspaceId },
          body: { name, jobText },
        });
        return record(workspaceId, created);
      }
      case "application.archive":
      case "application.rename": {
        const { workspaceId, applicationId } = command.input;
        const updated = await client.call(
          "PATCH /v1/workspaces/{workspaceId}/applications/{applicationId}",
          {
            path: { workspaceId, applicationId },
            body:
              command.type === "application.archive"
                ? { archived: command.input.archived }
                : { name: command.input.name },
          },
        );
        return record(workspaceId, updated);
      }
      case "application.set-models": {
        const { workspaceId, applicationId, modelProfiles } = command.input;
        const updated = await client.call(
          "PUT /v1/workspaces/{workspaceId}/applications/{applicationId}/models",
          { path: { workspaceId, applicationId }, body: { modelProfiles } },
        );
        return record(workspaceId, updated);
      }
      case "application.choose-run": {
        const { workspaceId, applicationId, runId, reason } = command.input;
        const updated = await client.call(
          "PUT /v1/workspaces/{workspaceId}/applications/{applicationId}/chosen-run",
          {
            path: { workspaceId, applicationId },
            body: { runId, ...(reason === undefined ? {} : { reason }) },
          },
        );
        return record(workspaceId, updated);
      }
      case "opportunity.create": {
        const { workspaceId, applicationId } = command.input;
        const sources = [];
        for (const source of command.input.sources) {
          if (source.kind !== "workspace-job-description") {
            sources.push(hostedSource(source));
            continue;
          }
          // The application's own job: the hosted service keeps pasted text in its record.
          const scoped = await scopedApplication(workspaceId, applicationId);
          const job = await client.call(
            "GET /v1/workspaces/{workspaceId}/applications/{applicationId}/job",
            { path: { workspaceId, applicationId: scoped.id } },
          );
          if (job.text === null) return refuse("Paste this application's job description first.");
          sources.push({
            id: source.id,
            kind: "pasted-content" as const,
            classification: source.classification,
            content: job.text,
            ...(source.capturedAt === undefined ? {} : { capturedAt: source.capturedAt }),
          });
        }
        const created = await client.call("POST /v1/workspaces/{workspaceId}/opportunities", {
          path: { workspaceId },
          body: {
            sources,
            ...(applicationId === undefined ? {} : { applicationId }),
          },
        });
        return projectOpportunityRecord(workspaceId, created, refuse);
      }
      case "opportunity.get": {
        const { workspaceId, briefId, version } = command.input;
        return projectOpportunityRecord(
          workspaceId,
          await brief(workspaceId, briefId, version),
          refuse,
        );
      }
      case "opportunity.list": {
        const { workspaceId, briefId } = command.input;
        const { versions } = await client.call(
          "GET /v1/workspaces/{workspaceId}/opportunities/{briefId}/versions",
          { path: { workspaceId, briefId } },
        );
        // The list carries each version's dates only, so each version is read for its record.
        const records = await Promise.all(
          versions.map(({ version }) => brief(workspaceId, briefId, version)),
        );
        return {
          workspaceId,
          briefId,
          versions: records.map((value) => projectOpportunityRecord(workspaceId, value, refuse)),
        };
      }
      case "opportunity.latest": {
        const { workspaceId } = command.input;
        const scoped = await scopedApplication(workspaceId, command.input.applicationId);
        const newest = scoped.briefs.reduce<Application["briefs"][number] | undefined>(
          (latest, candidate) =>
            latest === undefined || Date.parse(candidate.createdAt) >= Date.parse(latest.createdAt)
              ? candidate
              : latest,
          undefined,
        );
        if (newest === undefined) return null;
        return projectLatestOpportunity(workspaceId, await brief(workspaceId, newest.briefId));
      }
      case "opportunity.edit": {
        const { workspaceId, briefId, expectedVersion, patch } = command.input;
        const edited = await client.call(
          "PATCH /v1/workspaces/{workspaceId}/opportunities/{briefId}",
          { path: { workspaceId, briefId }, body: { expectedVersion, patch } },
        );
        return projectOpportunityRecord(workspaceId, edited, refuse);
      }
      case "opportunity.review": {
        const { workspaceId, briefId, expectedVersion } = command.input;
        const reviewed = await client.call(
          "POST /v1/workspaces/{workspaceId}/opportunities/{briefId}/review",
          { path: { workspaceId, briefId }, body: { expectedVersion } },
        );
        return projectOpportunityRecord(workspaceId, reviewed, refuse);
      }
      case "run.status": {
        const { workspaceId, runId } = command.input;
        if (runId !== undefined) return runStatus(workspaceId, await run(workspaceId, runId));
        // Without a run named, the workspace's newest run, as the desktop's status reads it.
        const runs = (await applications(workspaceId)).flatMap((each) => each.runs);
        const newest = newestApplicationRunId(runs);
        return runStatus(workspaceId, newest === null ? undefined : await run(workspaceId, newest));
      }
      case "run.start": {
        const { workspaceId, applicationId, opportunityBrief, candidateProfile } = command.input;
        if (command.input.writingPolicyOverrideChecksum !== undefined) {
          return refuse("A one-run writing policy cannot be used on the hosted service yet.");
        }
        const begun = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
          path: { workspaceId },
          header: { "idempotency-key": idempotencyKey() },
          body: {
            ...(applicationId === undefined ? {} : { applicationId }),
            ...(opportunityBrief === undefined
              ? {}
              : { opportunityBrief: { ...opportunityBrief } }),
            ...(candidateProfile === undefined
              ? {}
              : { candidateProfile: { ...candidateProfile } }),
          },
        });
        return runStatus(workspaceId, begun);
      }
      case "run.pause":
      case "run.resume":
      case "run.stop": {
        const { workspaceId, runId } = command.input;
        const path = { workspaceId, runId };
        const changed =
          command.type === "run.pause"
            ? await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/pause", { path })
            : command.type === "run.resume"
              ? await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/resume", {
                  path,
                  // Resuming queues the run again, so a retry must not queue it twice.
                  header: { "idempotency-key": idempotencyKey() },
                })
              : await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/stop", { path });
        return runStatus(workspaceId, changed);
      }
      case "models.list": {
        const { provider } = command.input;
        if (provider !== "anthropic" && provider !== "openai") {
          return refuse("The hosted service runs Anthropic and OpenAI models only.");
        }
        const catalog = await client.call("GET /v1/model-catalog", {});
        const ids = [
          ...new Set(
            catalog.models.filter(({ company }) => company === provider).map(({ model }) => model),
          ),
        ];
        return {
          provider,
          models: ids.map((id) => ({ id })),
          truncated: false,
          source: "live",
          retrievedAt: new Date().toISOString(),
        };
      }
      case "models.preview-independence": {
        const authorLineage = deriveModelLineage(command.input.author);
        const criticLineage = deriveModelLineage(command.input.critic);
        return { authorLineage, criticLineage, lineagesDistinct: authorLineage !== criticLineage };
      }
      case "models.profile-support": {
        const catalog = await client.call("GET /v1/model-catalog", {});
        return {
          workspaceId: command.input.workspaceId,
          // The hosted service reaches both companies with its own keys, never a person's session.
          authModes: { anthropic: "api-key", openai: "api-key" },
          profiles: catalog.models.map(({ id, version }) => ({ id, version, supported: true })),
        };
      }
      case "workspace.configure-models": {
        const { workspaceId, independenceOverrideRationale } = command.input;
        if (command.input.localEndpoint !== undefined) {
          return refuse("A local model server cannot be used on the hosted service.");
        }
        if (
          command.input.authorLineage !== undefined ||
          command.input.criticLineage !== undefined
        ) {
          return refuse("The hosted service derives each model's lineage itself.");
        }
        const changed = await client.call("PATCH /v1/workspaces/{workspaceId}/models", {
          path: { workspaceId },
          body: {
            author: {
              company: hostedCompany(command.input.authorCompany),
              model: command.input.authorModel,
            },
            critic: {
              company: hostedCompany(command.input.criticCompany),
              model: command.input.criticModel,
            },
            ...(independenceOverrideRationale === undefined
              ? {}
              : { independenceOverrideRationale }),
          },
        });
        // The screens address the workspace by the id they asked with, never the driver's own.
        return {
          workspaceId,
          authorCompany: changed.author.company,
          authorModel: changed.author.model,
          criticCompany: changed.critic.company,
          criticModel: changed.critic.model,
          localEndpoint: null,
        };
      }
      case "writing-policy.read": {
        const { workspaceId } = command.input;
        try {
          const active = await client.call("GET /v1/workspaces/{workspaceId}/writing-policy", {
            path: { workspaceId },
          });
          return { workspaceId, ...pick(active), isDefaultTemplate: false };
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 404) throw error;
        }
        // Nothing saved yet: the editor starts from the template, and reading it saves nothing.
        const { content } = await client.call("GET /v1/writing-policy-template", {});
        return { workspaceId, content, version: null, checksum: null, isDefaultTemplate: true };
      }
      case "writing-policy.save": {
        const { workspaceId, content } = command.input;
        const saved = await client.call("PUT /v1/workspaces/{workspaceId}/writing-policy", {
          path: { workspaceId },
          body: { content },
        });
        return { workspaceId, version: saved.version, checksum: saved.checksum };
      }
      case "review.load": {
        // The server projects the review as the desktop host does; the port validates each field.
        const { applicationId, runId } = command.input;
        return reviewState(command.input.workspaceId ?? options.workspaceId ?? ownerWorkspaceId, {
          ...(applicationId === undefined ? {} : { applicationId }),
          ...(runId === undefined ? {} : { runId }),
        });
      }
      case "review.dispatch": {
        const { workspaceId, action, applicationId, runId } = command.input;
        if (action.type !== "start") {
          await reviewAction(workspaceId, runId, action);
          // The run as the server now holds it, decisions and edits included.
          return reviewState(workspaceId, {
            ...(applicationId === undefined ? {} : { applicationId }),
            runId,
          });
        }
        if (action.pageTarget !== undefined) {
          return refuse("Set the draft's length in the writing policy on the hosted service.");
        }
        if (action.requirementsSource === "job-description") {
          return refuse("The hosted service starts a run from the reviewed requirements.");
        }
        const scoped = await scopedApplication(workspaceId, command.input.applicationId);
        const opportunityBrief =
          reviewedBrief(scoped) ?? refuse("Review this application's requirements first.");
        const { modelProfiles, candidateProfile } = action;
        await client.call("POST /v1/workspaces/{workspaceId}/runs", {
          path: { workspaceId },
          header: { "idempotency-key": idempotencyKey() },
          body: {
            applicationId: scoped.id,
            opportunityBrief,
            ...(candidateProfile === undefined
              ? {}
              : { candidateProfile: { ...candidateProfile } }),
            ...(modelProfiles === undefined
              ? {}
              : {
                  modelProfiles: {
                    author: { id: modelProfiles.author.id, version: modelProfiles.author.version },
                    critic: { id: modelProfiles.critic.id, version: modelProfiles.critic.version },
                  },
                }),
          },
        });
        // The started run is the application's newest, so the screens load it as they do after a
        // desktop start.
        return reviewState(workspaceId, { applicationId: scoped.id });
      }
      default:
        throw new Refusal(
          "capability-unavailable",
          "This is not available on the hosted service yet.",
        );
    }
  }

  return {
    capabilities: hostedBridgeCapabilities,
    invoke: async (command): Promise<BridgeResult<unknown>> => {
      try {
        return { ok: true, value: await answer(command) };
      } catch (error) {
        if (error instanceof Refusal) {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        if (error instanceof ApiRequestError) {
          options.onRefusal?.(error);
          return { ok: false, error: { code: errorCode(error.status), message: error.message } };
        }
        return { ok: false, error: { code: "operation-failed", message: describeError(error) } };
      }
    },
  };
}
