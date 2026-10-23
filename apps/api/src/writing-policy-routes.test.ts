import {
  type ApplicationService,
  CliUserError,
  type ConfigureWritingPolicyCommand,
  WorkspaceNotFoundError,
  type WritingPolicyVersionView,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const policyUrl = "/v1/workspaces/workspace-1/writing-policy";
const root = "/tenants/owner/workspaces/workspace-1";
const content = "# Writing policy\n\nKeep each bullet to one sentence.";

const active: WritingPolicyVersionView = {
  checksum: "c".repeat(64),
  version: `sha256:${"c".repeat(12)}`,
  schemaVersion: 1,
  createdAt: "2026-10-23T08:00:00.000Z",
  priorChecksum: null,
  policy: { schemaVersion: 1, content, checksum: "c".repeat(64), version: "v", rules: [] },
};

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: methods as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

const put = (payload: unknown) =>
  app.inject({
    method: "PUT",
    url: policyUrl,
    headers: { authorization },
    payload: payload as Record<string, unknown>,
  });

afterEach(async () => {
  await app.close();
});

describe("writing policy routes", () => {
  it("saves the text as the active policy and answers it without its compiled rules", async () => {
    const configureWritingPolicy = vi.fn(async (_command: ConfigureWritingPolicyCommand) => ({}));
    const getWritingPolicy = vi.fn(async () => active);
    await build({
      configureWritingPolicy:
        configureWritingPolicy as unknown as ApplicationService["configureWritingPolicy"],
      getWritingPolicy,
    });

    const response = await put({ content });

    expect(response.statusCode).toBe(200);
    expect(configureWritingPolicy.mock.calls[0]?.[0]).toEqual({ root, content });
    expect(getWritingPolicy).toHaveBeenCalledWith({ root, includeContent: true });
    expect(response.json()).toEqual({
      checksum: active.checksum,
      version: active.version,
      createdAt: active.createdAt,
      priorChecksum: null,
      content,
    });
  });

  it.each([
    ["no text", {}],
    ["empty text", { content: "" }],
    ["a file path", { content, sourcePath: "/etc/hostname" }],
    ["text over 64 KiB", { content: "a".repeat(64 * 1024 + 1) }],
  ])("refuses %s before saving", async (_name, payload) => {
    const configureWritingPolicy = vi.fn();
    await build({ configureWritingPolicy });

    const response = await put(payload);

    expect(response.statusCode).toBe(400);
    expect(configureWritingPolicy).not.toHaveBeenCalled();
  });

  it("answers 422 with the service's refusal, such as text that is only whitespace", async () => {
    await build({
      configureWritingPolicy: async () => {
        throw new CliUserError("The writing policy is empty.");
      },
    });

    const response = await put({ content: "   " });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toEqual({
      code: "rejected",
      message: "The writing policy is empty.",
    });
  });

  it("answers 404 for a workspace that does not exist", async () => {
    await build({
      configureWritingPolicy: async () => {
        throw new WorkspaceNotFoundError(root);
      },
    });

    expect((await put({ content })).statusCode).toBe(404);
  });

  it("reads the active policy, or answers 404 when there is none", async () => {
    await build({
      getWritingPolicy: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(undefined),
    });

    const found = await app.inject({ method: "GET", url: policyUrl, headers: { authorization } });
    const missing = await app.inject({ method: "GET", url: policyUrl, headers: { authorization } });

    expect(found.statusCode).toBe(200);
    expect(found.json().content).toBe(content);
    expect(missing.statusCode).toBe(404);
  });

  it("lists versions without their text", async () => {
    await build({ listWritingPolicyVersions: async () => [active] });

    const response = await app.inject({
      method: "GET",
      url: `${policyUrl}/versions`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      versions: [
        {
          checksum: active.checksum,
          version: active.version,
          createdAt: active.createdAt,
          priorChecksum: null,
        },
      ],
    });
  });
});
