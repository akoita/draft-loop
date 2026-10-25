import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { describe, expect, it, vi } from "vitest";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";
import { hostedKnowledgeStoreId, type PickFile } from "./knowledge-bridge.js";

const workspaceId = "record-a";
const storeId = hostedKnowledgeStoreId;

/** Fictional bases and sources; no real candidate material. */
const base = (id: string, displayName: string): ApiSchemas["KnowledgeBase"] => ({
  id,
  displayName,
  description: "",
  state: "active",
  createdAt: "2026-10-25T00:00:00.000Z",
  archivedAt: null,
});

const source = (id: string, versionId: string): ApiSchemas["KnowledgeSource"] => ({
  id,
  knowledgeBaseId: "kb-a",
  displayName: "example-cv.md",
  kind: "file",
  versionId,
  mediaType: "text/markdown",
  sizeBytes: 42,
  checksum: "b".repeat(64),
  createdAt: "2026-10-25T00:00:00.000Z",
});

const workspace = (knowledgeBaseIds: string[]) =>
  ({ id: workspaceId, knowledgeBaseIds }) as unknown as ApiSchemas["Workspace"];

type Handler = (input: Record<string, unknown>) => unknown;

function portOver(handlers: Readonly<Record<string, Handler>>, pickFile?: PickFile) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  const onRefusal = vi.fn();
  const port = createCapabilityPort(
    createHttpBridge({ client, onRefusal, ...(pickFile === undefined ? {} : { pickFile }) }),
  );
  return { port, calls, onRefusal };
}

const markdown = (name: string, text = "# Example CV\n\nBuilt TypeScript services.\n") =>
  new File([text], name, { type: "text/markdown" });

describe("career evidence over HTTP", () => {
  it("lists only the bases the workspace owns, with its selection, in one store", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}": () => workspace(["kb-a", "kb-other"]),
      // The API lists by the record in sign-in mode, so another record's base never arrives.
      "GET /v1/knowledge-bases": () => ({ knowledgeBases: [base("kb-a", "Career evidence")] }),
    });

    const result = await port.execute({ type: "knowledge.current", input: { workspaceId } });

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      store: {
        storeId,
        knowledgeBases: [
          {
            id: "kb-a",
            displayName: "Career evidence",
            description: "",
            state: "active",
            isDefault: false,
          },
        ],
      },
      selectedKnowledgeBaseIds: ["kb-a"],
    });
    expect(calls.find(({ operation }) => operation === "GET /v1/knowledge-bases")?.input).toEqual({
      query: { workspaceId },
    });
  });

  it("answers no store for a workspace without bases, so the first add creates one", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}": () => workspace([]),
      "GET /v1/knowledge-bases": () => ({ knowledgeBases: [] }),
      "POST /v1/knowledge-bases": () => base("kb-new", "Career evidence"),
    });

    const current = await port.execute({ type: "knowledge.current", input: { workspaceId } });
    const ensured = await port.execute({
      type: "knowledge.ensure-default",
      input: { workspaceId },
    });

    expect(current).toEqual({ ok: true, value: { store: null, selectedKnowledgeBaseIds: [] } });
    expect(ensured).toEqual({
      ok: true,
      value: { storeId, knowledgeBaseId: "kb-new", displayName: "Career evidence", created: true },
    });
    expect(calls.at(-1)?.input).toEqual({
      body: { displayName: "Career evidence", workspaceId },
    });
  });

  it("reuses the selected base instead of creating another", async () => {
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}": () => workspace(["kb-b"]),
      "GET /v1/knowledge-bases": () => ({
        knowledgeBases: [base("kb-a", "Career evidence"), base("kb-b", "Portfolio")],
      }),
    });

    const ensured = await port.execute({
      type: "knowledge.ensure-default",
      input: { workspaceId },
    });

    expect(ensured).toMatchObject({ ok: true, value: { knowledgeBaseId: "kb-b", created: false } });
    expect(calls.some(({ operation }) => operation === "POST /v1/knowledge-bases")).toBe(false);
  });

  it("makes or reuses the base a person names, and adds a first source to the newest base", async () => {
    let owned = [
      { ...base("kb-old", "Career evidence"), createdAt: "2026-10-24T00:00:00.000Z" },
      { ...base("kb-portfolio", "Portfolio"), createdAt: "2026-10-25T00:00:00.000Z" },
    ];
    const { port, calls } = portOver({
      "GET /v1/workspaces/{workspaceId}": () => workspace([]),
      "GET /v1/knowledge-bases": () => ({ knowledgeBases: owned }),
      "POST /v1/knowledge-bases": (input) => {
        const made = base("kb-notes", (input.body as { displayName: string }).displayName);
        owned = [...owned, { ...made, createdAt: "2026-10-26T00:00:00.000Z" }];
        return made;
      },
    });
    const ensure = (displayName?: string) =>
      port.execute({
        type: "knowledge.ensure-default",
        input: displayName === undefined ? { workspaceId } : { workspaceId, displayName },
      });

    expect(await ensure()).toMatchObject({
      ok: true,
      value: { knowledgeBaseId: "kb-portfolio", created: false },
    });
    expect(await ensure("Portfolio")).toMatchObject({
      ok: true,
      value: { knowledgeBaseId: "kb-portfolio", created: false },
    });
    expect(await ensure("Project notes")).toEqual({
      ok: true,
      value: { storeId, knowledgeBaseId: "kb-notes", displayName: "Project notes", created: true },
    });
    expect(calls.filter(({ operation }) => operation === "POST /v1/knowledge-bases")).toEqual([
      {
        operation: "POST /v1/knowledge-bases",
        input: { body: { displayName: "Project notes", workspaceId } },
      },
    ]);
    // The base just named is the newest, so the first source goes there.
    expect(await ensure()).toMatchObject({ ok: true, value: { knowledgeBaseId: "kb-notes" } });
  });

  it("uploads the file the person picks, and tells a new source from one already held", async () => {
    let held: ApiSchemas["KnowledgeSource"][] = [];
    const { port, calls } = portOver(
      {
        "GET /v1/knowledge-bases/{knowledgeBaseId}/sources": () => ({ sources: held }),
        "POST /v1/knowledge-bases/{knowledgeBaseId}/sources": () => {
          const added = source("src-1", "ver-1");
          held = [added];
          return added;
        },
      },
      async () => markdown("example-cv.md"),
    );
    const input = { storeId, knowledgeBaseId: "kb-a", selection: "native-dialog" } as const;

    const first = await port.execute({ type: "knowledge.import-file", input });
    const again = await port.execute({ type: "knowledge.import-file", input });

    expect(first).toEqual({
      ok: true,
      value: {
        storeId,
        knowledgeBaseId: "kb-a",
        sourceId: "src-1",
        kind: "file",
        versionId: "ver-1",
        version: 1,
        created: true,
        outcome: "added",
      },
    });
    expect(again).toMatchObject({
      ok: true,
      value: { created: false, outcome: "already-present" },
    });
    const upload = calls.find(({ operation }) => operation.startsWith("POST"));
    expect(upload?.input).toMatchObject({
      path: { knowledgeBaseId: "kb-a" },
      query: { name: "example-cv.md" },
      contentType: "text/markdown",
    });
  });

  it("reads a closed picker as a cancelled import, and an unsupported file before any request", async () => {
    const cancelled = portOver({}, async () => undefined);
    const unsupported = portOver({}, async () => new File(["x"], "photo.png"));
    const input = { storeId, knowledgeBaseId: "kb-a", selection: "native-dialog" } as const;

    expect(await cancelled.port.execute({ type: "knowledge.import-file", input })).toMatchObject({
      ok: false,
      error: {
        code: "permission-denied",
        message: "Candidate knowledge file import was cancelled.",
      },
    });
    expect(await unsupported.port.execute({ type: "knowledge.import-file", input })).toMatchObject({
      ok: false,
      error: { code: "operation-failed", message: expect.stringContaining("PDF") },
    });
    expect([...cancelled.calls, ...unsupported.calls]).toEqual([]);
  });

  it.each([
    [413, "example-cv.md is larger than this service accepts."],
    [415, "example-cv.md: DraftLoop takes PDF, DOCX, Markdown and text files."],
  ])("explains a %i refusal of the upload in the person's words", async (status, message) => {
    const { port, onRefusal } = portOver(
      {
        "GET /v1/knowledge-bases/{knowledgeBaseId}/sources": () => ({ sources: [] }),
        "POST /v1/knowledge-bases/{knowledgeBaseId}/sources": () => {
          throw new ApiRequestError(status, "refused", "The file was refused.");
        },
      },
      async () => markdown("example-cv.md"),
    );

    const result = await port.execute({
      type: "knowledge.import-file",
      input: { storeId, knowledgeBaseId: "kb-a", selection: "native-dialog" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "operation-failed", message: expect.stringContaining(message) },
    });
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("selects a base for the workspace's runs, and refuses another store's base", async () => {
    const { port, calls } = portOver({
      "PUT /v1/workspaces/{workspaceId}/knowledge-selection": () => workspace(["kb-a"]),
    });

    const selected = await port.execute({
      type: "knowledge.select",
      input: { workspaceId, entries: [{ storeId, knowledgeBaseId: "kb-a" }] },
    });
    const foreign = await port.execute({
      type: "knowledge.select",
      input: { workspaceId, entries: [{ storeId: "desktop-store", knowledgeBaseId: "kb-a" }] },
    });

    expect(selected).toEqual({
      ok: true,
      value: { workspaceId, entries: [{ storeId, knowledgeBaseId: "kb-a" }] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual({
      path: { workspaceId },
      body: { knowledgeBaseIds: ["kb-a"] },
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "operation-failed" } });
  });

  it("counts a base's sources as ready", async () => {
    const { port } = portOver({
      "GET /v1/knowledge-bases/{knowledgeBaseId}/sources": () => ({
        sources: [source("src-1", "ver-1"), source("src-2", "ver-2")],
      }),
    });

    const result = await port.execute({
      type: "knowledge.readiness",
      input: { storeId, knowledgeBaseId: "kb-a" },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        storeId,
        knowledgeBaseId: "kb-a",
        state: "active",
        sourceCount: 2,
        readyCount: 2,
        blockedCount: 0,
        blockerReasons: [],
      },
    });
  });
});
