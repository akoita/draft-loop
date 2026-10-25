import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BlobStoragePort, openSqliteStorage } from "@draft-loop/storage";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import {
  type CandidateKnowledgeRunStore,
  candidateKnowledgeRunOperations,
  runOnlyCandidateKnowledgeStore,
} from "@draft-loop/storage/run-knowledge-store";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalCandidateProfileDerivationApprovalErrorMessage } from "./candidate-profile-derivation.js";
import { createHostedApplicationDriver } from "./hosted-driver.js";
import { createApplicationService } from "./index.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "./workspace-settings.js";

const silent = { write: () => undefined };
const workspace = "/tenants/tenant-a/workspaces/workspace-1";
const storeReference = "/tenants/tenant-a/knowledge-stores/hosted-store";
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function memorySettings(): WorkspaceSettingsPort {
  const documents = new Map<string, string>();
  const key = (reference: string, name: WorkspaceSettingName) => `${reference}#${name}`;
  return {
    read: async (reference, name) => documents.get(key(reference, name)),
    write: async (reference, name, content) => {
      documents.set(key(reference, name), content);
    },
    remove: async (reference, name) => documents.delete(key(reference, name)),
  };
}

const noExports: BlobStoragePort = {
  put: async () => {
    throw new Error("no exports in this test");
  },
  get: async () => undefined,
  exists: async () => false,
  delete: async () => false,
};

/** Only the operations a hosted store offers, as the Postgres store offers them. */
function hostedStore(handle: CandidateKnowledgeStoreHandle): CandidateKnowledgeStoreHandle {
  const operations = Object.fromEntries(
    candidateKnowledgeRunOperations.map((name) => [name, handle[name].bind(handle)]),
  );
  return runOnlyCandidateKnowledgeStore({
    descriptor: handle.descriptor,
    ...operations,
  } as CandidateKnowledgeRunStore);
}

/** A hosted fixture workspace whose selection names one synthetic career source. */
async function hostedWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-hosted-profile-"));
  scratch.push(directory);
  const storeRoot = join(directory, "store");
  const sourcePath = join(directory, "career.md");
  await writeFile(
    sourcePath,
    "# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\n- Built TypeScript services with deterministic testing.\n",
  );
  const ids = ["hosted-store", "hosted-ckb", "hosted-source", "hosted-version"];
  const knowledge = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-10-25T10:00:00.000Z",
  });
  await knowledge.initializeStore({ storeRoot });
  await knowledge.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "hosted-ckb",
    sourcePath,
  });
  const history = join(directory, "history.sqlite");
  const service = createApplicationService(
    createHostedApplicationDriver({
      settings: memorySettings(),
      storage: { open: async () => openSqliteStorage(history), exportBlobs: noExports },
      openKnowledgeStore: async (reference) => {
        if (reference !== storeReference) throw new Error("unknown store");
        return hostedStore(await openCandidateKnowledgeStore(storeRoot));
      },
    }),
  );
  await service.initialize(
    { root: workspace, jobDescription: "job.md", sources: "sources", fixtureMode: true },
    silent,
  );
  await service.configureKnowledgeSelection(
    {
      root: workspace,
      entries: [
        { storeRoot: storeReference, storeId: "hosted-store", knowledgeBaseId: "hosted-ckb" },
      ],
    },
    silent,
  );
  return service;
}

describe("hosted career profile derivation", () => {
  it("derives a fixture workspace's profile from its hosted store and saves a version", async () => {
    const service = await hostedWorkspace();

    const derived = await service.deriveCanonicalCandidateProfile({
      root: workspace,
      profileId: "career",
      allowProviderData: true,
    });

    expect(derived.profile).toMatchObject({ id: "career", version: 1, status: "draft" });
    expect(
      await service.getCanonicalCandidateProfile({ root: workspace, profileId: "career" }),
    ).toMatchObject({ profile: { version: 1 } });
  });

  it("saves nothing when the derivation was cancelled before it began", async () => {
    const service = await hostedWorkspace();
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.deriveCanonicalCandidateProfile({
        root: workspace,
        profileId: "career",
        allowProviderData: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(
      await service.listCanonicalCandidateProfileVersions({ root: workspace, profileId: "career" }),
    ).toEqual([]);
  });

  it("refuses without the person's approval, as the desktop does", async () => {
    const service = await hostedWorkspace();

    await expect(
      service.deriveCanonicalCandidateProfile({
        root: workspace,
        profileId: "career",
        allowProviderData: false,
      }),
    ).rejects.toThrow(canonicalCandidateProfileDerivationApprovalErrorMessage);
  });
});
