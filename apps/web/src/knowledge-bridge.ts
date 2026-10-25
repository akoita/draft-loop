import type { BridgeCommand } from "@draft-loop/ui/bridge";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { Refusal, refuse } from "./bridge-refusal.js";
import {
  acceptedSourceFiles,
  sourceFileProblem,
  sourceMediaType,
  uploadErrorMessage,
} from "./sources-model.js";

/**
 * The knowledge commands the hosted service serves, in the port's order. Folders, URLs, store
 * switching, backups and refreshes stay hidden by capability.
 */
export const hostedKnowledgeCapabilities = [
  "knowledge.current",
  "knowledge.readiness",
  "knowledge.import-file",
  "knowledge.ensure-default",
  "knowledge.select",
] as const;

type KnowledgeCommandType = (typeof hostedKnowledgeCapabilities)[number];
export type KnowledgeCommand = Extract<BridgeCommand, { type: KnowledgeCommandType }>;

/**
 * The tenant's one store, as the screens name it. The server never tells a client its store or
 * where it is kept, so every base the screens see belongs to this one.
 */
export const hostedKnowledgeStoreId = "hosted-store";

/** The base a first source creates, as the desktop names its default one. */
export const defaultHostedKnowledgeBaseName = "Career evidence";

/** Opens the browser's file picker; undefined when the person closes it without a file. */
export type PickFile = (accept: string) => Promise<File | undefined>;

/** The browser's own file input, opened by the person's click on the screens' add button. */
export const browserFilePicker: PickFile = (accept) =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? undefined), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve(undefined), { once: true });
    input.click();
  });

export function isKnowledgeCommand(command: BridgeCommand): command is KnowledgeCommand {
  return (hostedKnowledgeCapabilities as readonly string[]).includes(command.type);
}

type KnowledgeBase = ApiSchemas["KnowledgeBase"];

/**
 * Answers the career evidence commands over the knowledge routes (ADR 0011, D9 and D11). The
 * screens see only the bases the workspace owns, which the API filters by `workspaceId` in
 * sign-in mode, and the bases it selects.
 */
export function createKnowledgeAnswers(client: ApiClient, pickFile: PickFile = browserFilePicker) {
  const workspace = (workspaceId: string) =>
    client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId } });
  const bases = async (workspaceId: string) =>
    (await client.call("GET /v1/knowledge-bases", { query: { workspaceId } })).knowledgeBases;
  const inStore = (storeId: string) => {
    if (storeId !== hostedKnowledgeStoreId) refuse("That knowledge store is not on this service.");
  };
  const summary = (base: KnowledgeBase) => ({
    id: base.id,
    displayName: base.displayName,
    description: base.description,
    state: base.state === "archived" ? ("archived" as const) : ("active" as const),
    isDefault: false,
  });
  const target = (base: KnowledgeBase, created: boolean) => ({
    storeId: hostedKnowledgeStoreId,
    knowledgeBaseId: base.id,
    displayName: base.displayName,
    created,
  });

  return async function answerKnowledge(command: KnowledgeCommand): Promise<unknown> {
    switch (command.type) {
      case "knowledge.current": {
        const { workspaceId } = command.input;
        const [{ knowledgeBaseIds }, owned] = await Promise.all([
          workspace(workspaceId),
          bases(workspaceId),
        ]);
        return {
          store:
            owned.length === 0
              ? null
              : { storeId: hostedKnowledgeStoreId, knowledgeBases: owned.map(summary) },
          selectedKnowledgeBaseIds: knowledgeBaseIds.filter((id) =>
            owned.some((base) => base.id === id),
          ),
        };
      }
      case "knowledge.readiness": {
        const { storeId, knowledgeBaseId } = command.input;
        inStore(storeId);
        const { sources } = await client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
          path: { knowledgeBaseId },
        });
        // Every listed source has its file held; quarantine is the shell's screening panel.
        return {
          storeId,
          knowledgeBaseId,
          state: "active",
          sourceCount: sources.length,
          readyCount: sources.length,
          blockedCount: 0,
          blockerReasons: [],
        };
      }
      case "knowledge.import-file": {
        const { storeId, knowledgeBaseId } = command.input;
        inStore(storeId);
        const file = await pickFile(acceptedSourceFiles);
        if (file === undefined) {
          throw new Refusal("permission-denied", "Candidate knowledge file import was cancelled.");
        }
        const contentType = sourceMediaType(file.name);
        const problem = sourceFileProblem(file);
        if (problem !== undefined || contentType === undefined) return refuse(problem ?? file.name);
        const sources = () =>
          client.call("GET /v1/knowledge-bases/{knowledgeBaseId}/sources", {
            path: { knowledgeBaseId },
          });
        try {
          // The API answers the same bytes with the source it holds; the list before tells which.
          const before = (await sources()).sources;
          const added = await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
            path: { knowledgeBaseId },
            query: { name: file.name },
            body: file,
            contentType,
          });
          const created = !before.some(
            ({ id, versionId }) => id === added.id && versionId === added.versionId,
          );
          return {
            storeId,
            knowledgeBaseId,
            sourceId: added.id,
            kind: "file",
            versionId: added.versionId,
            // Each hosted source holds one file, so it is always the first version.
            version: 1,
            created,
            outcome: created ? "added" : "already-present",
          };
        } catch (error) {
          if (error instanceof ApiRequestError && (error.status === 413 || error.status === 415)) {
            return refuse(uploadErrorMessage(file.name, error));
          }
          throw error;
        }
      }
      case "knowledge.ensure-default": {
        const { workspaceId } = command.input;
        const [{ knowledgeBaseIds }, owned] = await Promise.all([
          workspace(workspaceId),
          bases(workspaceId),
        ]);
        const active = owned.filter(({ state }) => state === "active");
        const existing =
          active.find(({ id }) => knowledgeBaseIds.includes(id)) ??
          active.find(({ displayName }) => displayName === defaultHostedKnowledgeBaseName);
        if (existing !== undefined) return target(existing, false);
        const created = await client.call("POST /v1/knowledge-bases", {
          body: { displayName: defaultHostedKnowledgeBaseName, workspaceId },
        });
        return target(created, true);
      }
      case "knowledge.select": {
        const { workspaceId, entries, combinationApproved } = command.input;
        for (const entry of entries) inStore(entry.storeId);
        const selected = await client.call("PUT /v1/workspaces/{workspaceId}/knowledge-selection", {
          path: { workspaceId },
          body: {
            knowledgeBaseIds: entries.map(({ knowledgeBaseId }) => knowledgeBaseId),
            ...(combinationApproved === true ? { combinationApproved } : {}),
          },
        });
        return {
          workspaceId,
          entries: selected.knowledgeBaseIds.map((knowledgeBaseId) => ({
            storeId: hostedKnowledgeStoreId,
            knowledgeBaseId,
          })),
        };
      }
    }
  };
}
