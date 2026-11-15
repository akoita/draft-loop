import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import type { RecordNames } from "@draft-loop/storage-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { sendError } from "./errors.js";
import { registerRecordNameRoutes } from "./record-name-routes.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const at = new Date("2026-11-15T08:00:00.000Z");

/** A server with one existing record, `record-a`, whose caller is a member of `tenant-1`. */
async function nameServer() {
  const stored: { tenantId: string; workspaceId: string; name: string; now: Date }[] = [];
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(sendError);
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    if (request.headers["x-test-member"] !== "yes") return;
    request.caller = { kind: "member", tenantId: "tenant-1", memberId: "member-a", role: "member" };
  });
  registerRecordNameRoutes(server, {
    recordNamesFor: (tenantId) =>
      ({
        set: async (input) => {
          stored.push({ tenantId, ...input });
          return input.name;
        },
      }) as RecordNames,
    service: {
      readWorkspace: async (root: string) => {
        if (root !== "root/record-a") throw new WorkspaceNotFoundError(root);
        return {};
      },
    } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => `root/${workspaceId}`,
    now: () => at,
  });
  app = server;
  const put = (workspaceId: string, name: unknown, signedIn = true) =>
    server.inject({
      method: "PUT",
      url: `/v1/workspaces/${workspaceId}/name`,
      headers: signedIn ? { "x-test-member": "yes" } : {},
      payload: { name },
    });
  return { put, stored };
}

describe("record name route", () => {
  it("stores a plain name with its spaces tidied, for the caller's tenant", async () => {
    const { put, stored } = await nameServer();

    const response = await put("record-a", "  Recherche d’emploi   2026 ");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "record-a", name: "Recherche d’emploi 2026" });
    expect(stored).toEqual([
      { tenantId: "tenant-1", workspaceId: "record-a", name: "Recherche d’emploi 2026", now: at },
    ]);
  });

  it("refuses an empty or over-long name and stores nothing", async () => {
    const { put, stored } = await nameServer();

    const empty = await put("record-a", "   ");
    const long = await put("record-a", "x".repeat(81));

    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("invalid_record_name");
    expect(long.statusCode).toBe(400);
    expect(stored).toEqual([]);
  });

  it("answers an unknown record as not found and a caller without a tenant as an error", async () => {
    const { put, stored } = await nameServer();

    expect((await put("record-missing", "A name")).statusCode).toBe(404);
    expect((await put("record-a", "A name", false)).statusCode).toBeGreaterThanOrEqual(400);
    expect(stored).toEqual([]);
  });
});
