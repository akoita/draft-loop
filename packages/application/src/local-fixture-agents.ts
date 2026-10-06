import { createHash } from "node:crypto";
import {
  createArtifact,
  createArtifactVersion,
  type NewArtifactInput,
} from "@draft-loop/artifacts";
import type { ContextSnapshot } from "@draft-loop/domain";
import type { AgentExecution, AuthorAgent, CriticAgent, Critique } from "@draft-loop/orchestrator";
import type { DraftArtifact } from "@draft-loop/schemas";

import { CliUserError } from "./cli-user-error.js";
import type { WorkspaceConfig } from "./local.js";
import { timestamp } from "./response-execution.js";
import { runModelIdentity } from "./run-model-profiles.js";

/** Deterministic synthetic author and critic used by fixture-mode workspaces. */

function execution<T>(output: T, provider: string, modelId: string): AgentExecution<T> {
  const serialized = JSON.stringify(output);
  const digest = createHash("sha256").update(serialized, "utf8").digest("hex");
  return {
    output,
    provider,
    modelId,
    providerRequestId: null,
    outputChecksum: digest,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0,
    completedAt: timestamp(),
  };
}

function fixtureArtifact(context: ContextSnapshot, current: DraftArtifact | null): DraftArtifact {
  const version = current === null ? 1 : current.version + 1;
  const suffix = `${version}-${context.id}`;
  const source = context.evidenceManifest[0];
  if (source === undefined) throw new CliUserError("At least one evidence source is required.");
  const requirementText = context.requirements.map((requirement) => requirement.text).join("; ");
  const summarySectionId = `summary-${suffix}`;
  const experienceSectionId = `experience-${suffix}`;
  const educationSectionId = `education-${suffix}`;
  const skillsSectionId = `skills-${suffix}`;
  const summaryBlockId = `summary-block-${suffix}`;
  const experienceBlockId = `experience-block-${suffix}`;
  const educationBlockId = `education-block-${suffix}`;
  const skillsBlockId = `skills-block-${suffix}`;
  const summaryClaimId = `summary-claim-${suffix}`;
  const summaryText = `Profile aligned to candidate-provided materials and requirements: ${requirementText}`;
  const input: NewArtifactInput = {
    id: `artifact-${suffix}`,
    createdAt: timestamp(),
    language: context.language,
    sections: [
      {
        id: summarySectionId,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          { id: summaryBlockId, type: "paragraph", text: summaryText, claimIds: [summaryClaimId] },
        ],
      },
      {
        id: experienceSectionId,
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          {
            id: experienceBlockId,
            type: "bullet",
            text: "Candidate source material is retained locally and should be reviewed before approval.",
            claimIds: [],
          },
        ],
      },
      {
        id: educationSectionId,
        title: "Education",
        kind: "education",
        order: 2,
        blocks: [
          {
            id: educationBlockId,
            type: "bullet",
            text: "Education entries are taken from candidate-provided materials and are not inferred.",
            claimIds: [],
          },
        ],
      },
      {
        id: skillsSectionId,
        title: "Skills",
        kind: "skills",
        order: 3,
        blocks: [
          {
            id: skillsBlockId,
            type: "bullet",
            text: "Skills are listed only where candidate-provided materials support them.",
            claimIds: [],
          },
        ],
      },
    ],
    claims: [
      {
        id: summaryClaimId,
        text: summaryText,
        sectionId: summarySectionId,
        blockId: summaryBlockId,
        substantive: true,
        status: "unverified",
        evidence: [
          {
            sourcePath: source.path,
            sourceChecksum: source.checksum,
            excerpt: "Local evidence source",
          },
        ],
      },
    ],
    decisions: [],
  };
  return current === null ? createArtifact(input) : createArtifactVersion(current, input);
}

export function fixtureAgents(
  config: WorkspaceConfig,
  context: ContextSnapshot,
): {
  readonly author: AuthorAgent;
  readonly critic: CriticAgent;
} {
  const authorIdentity = runModelIdentity(
    { company: config.authorCompany, modelId: config.authorModel },
    context.modelConfiguration.author,
  );
  const criticIdentity = runModelIdentity(
    { company: config.criticCompany, modelId: config.criticModel },
    context.modelConfiguration.critic,
  );
  const waitForFixtureStep = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolveDelay, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolveDelay();
      }, 500);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  return {
    author: {
      execute: async ({ currentArtifact, signal }) => {
        await waitForFixtureStep(signal);
        return execution(
          fixtureArtifact(context, currentArtifact),
          authorIdentity.company,
          authorIdentity.modelId,
        );
      },
    },
    critic: {
      execute: async ({ artifact, signal }) => {
        await waitForFixtureStep(signal);
        const firstClaim = artifact.claims[0];
        const findings: Critique["findings"] =
          artifact.version === 1 && firstClaim !== undefined
            ? [
                {
                  id: "fixture-unsupported-claim",
                  code: "unsupported-claim",
                  category: "factuality",
                  severity: "error",
                  message:
                    "Synthetic pilot critic requires the lead claim to be compared with candidate-provided materials.",
                  claimId: firstClaim.id,
                },
              ]
            : [];
        return execution<Critique>({ findings }, criticIdentity.company, criticIdentity.modelId);
      },
    },
  };
}
