import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import {
  type ConsentEntry,
  type ConsentLedger,
  currentConsents,
  requireConsentEntryInput,
} from "@draft-loop/storage/consent-ledger";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { registerConsentRoutes } from "./consent-routes.js";
import { sendError } from "./errors.js";
import { cloudLoggingOptions } from "./logging.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const consentsUrl = "/v1/workspaces/coach-north/consents";

/** An in-memory ledger that keeps the port's rules. */
function memoryLedger(): ConsentLedger {
  const entries: ConsentEntry[] = [];
  const history = async (workspaceId: string) =>
    entries.filter((entry) => entry.workspaceId === workspaceId);
  return {
    record: async (input) => {
      const accepted = requireConsentEntryInput(input);
      const entry = {
        ...accepted,
        providers: accepted.providers ?? [],
        id: `consent-${entries.length + 1}`,
        recordedAt: `2026-10-24T09:00:0${entries.length}.000Z`,
      };
      entries.push(entry);
      return entry;
    },
    history,
    current: async (workspaceId) => currentConsents(await history(workspaceId)),
  };
}

/** The API workspace `coach-north` is the record `workspace-1`; any other id is unknown. */
const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/t/workspaces/coach-north") throw new WorkspaceNotFoundError(root);
    return { id: "workspace-1" };
  },
} as unknown as ApplicationService;

let app: FastifyInstance | undefined;
let logLines: string[];

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The routes alone, with callers from a test header: `owner`, or a member's id. */
async function routesServer(ledger: ConsentLedger = memoryLedger()): Promise<FastifyInstance> {
  logLines = [];
  const server = Fastify({
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
  }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(sendError);
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    const header = request.headers["x-test-caller"];
    if (typeof header !== "string") return;
    request.caller =
      header === "owner"
        ? { kind: "owner" }
        : { kind: "member", tenantId: "t", memberId: header, role: "member" };
  });
  registerConsentRoutes(server, {
    service,
    workspaceRoot: (workspaceId) => `/tenants/t/workspaces/${workspaceId}`,
    consents: ledger,
  });
  app = server;
  return server;
}

const post = (server: FastifyInstance, payload: Record<string, unknown>, caller = "member-7") =>
  server.inject({
    method: "POST",
    url: consentsUrl,
    headers: { "x-test-caller": caller },
    payload,
  });

describe("consent routes", () => {
  it("records grants and withdrawals by the caller and reads the current state and history", async () => {
    const server = await routesServer();

    const stored = await post(server, {
      kind: "material-storage",
      action: "granted",
      basis: "contract",
      note: "Placement agreement signed.",
      // A recorder in the body is refused: the caller is the recorder.
    });
    expect(stored.statusCode).toBe(201);
    expect(stored.json()).toEqual({
      id: "consent-1",
      kind: "material-storage",
      action: "granted",
      basis: "contract",
      recordedBy: { kind: "member", memberId: "member-7" },
      providers: [],
      note: "Placement agreement signed.",
      recordedAt: "2026-10-24T09:00:00.000Z",
    });
    const shared = await post(
      server,
      {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["openai", "anthropic"],
      },
      "owner",
    );
    expect(shared.statusCode).toBe(201);
    expect(shared.json()).toMatchObject({
      recordedBy: { kind: "owner" },
      providers: ["anthropic", "openai"],
    });
    const withdrawn = await post(server, {
      kind: "provider-transmission",
      action: "withdrawn",
      basis: "candidate-consent",
    });
    expect(withdrawn.statusCode).toBe(201);

    const read = await server.inject({
      method: "GET",
      url: consentsUrl,
      headers: { "x-test-caller": "member-8" },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({
      current: {
        "material-storage": stored.json(),
        "provider-transmission": withdrawn.json(),
      },
      history: [stored.json(), shared.json(), withdrawn.json()],
    });

    // Each entry is mirrored in the audit log by ids, kind and action, never by its note.
    const audits = logLines
      .map((line) => JSON.parse(line) as { audit?: Record<string, unknown> })
      .flatMap((line) => (line.audit === undefined ? [] : [line.audit]));
    expect(audits).toEqual([
      {
        action: "consent_recorded",
        workspaceId: "coach-north",
        consentId: "consent-1",
        kind: "material-storage",
        consentAction: "granted",
        memberId: "member-7",
      },
      {
        action: "consent_recorded",
        workspaceId: "coach-north",
        consentId: "consent-2",
        kind: "provider-transmission",
        consentAction: "granted",
      },
      {
        action: "consent_recorded",
        workspaceId: "coach-north",
        consentId: "consent-3",
        kind: "provider-transmission",
        consentAction: "withdrawn",
        memberId: "member-7",
      },
    ]);
    expect(logLines.join("\n")).not.toContain("Placement agreement");
  });

  it("answers an empty ledger with null current entries", async () => {
    const server = await routesServer();
    const read = await server.inject({
      method: "GET",
      url: consentsUrl,
      headers: { "x-test-caller": "owner" },
    });
    expect(read.json()).toEqual({
      current: { "material-storage": null, "provider-transmission": null },
      history: [],
    });
  });

  it("refuses a recorder in the body, an unknown provider and a basis the kind does not allow", async () => {
    const server = await routesServer();
    const base = { kind: "provider-transmission", action: "granted", basis: "candidate-consent" };

    const recorder = await post(server, {
      ...base,
      providers: ["openai"],
      recordedBy: { kind: "owner" },
    });
    expect(recorder.statusCode).toBe(400);
    expect(recorder.json().error.code).toBe("invalid_request");
    expect((await post(server, { ...base, providers: ["acme"] })).statusCode).toBe(400);

    const contract = await post(server, { ...base, basis: "contract", providers: ["openai"] });
    expect(contract.statusCode).toBe(400);
    expect(contract.json().error).toEqual({
      code: "invalid_input",
      message: "The basis does not apply to this consent kind.",
    });
    const unnamed = await post(server, base);
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.json().error.code).toBe("invalid_input");
  });

  it("answers an unknown workspace as not found", async () => {
    const server = await routesServer();
    const read = await server.inject({
      method: "GET",
      url: "/v1/workspaces/unknown/consents",
      headers: { "x-test-caller": "owner" },
    });
    expect(read.statusCode).toBe(404);
    expect(read.json().error).toEqual({ code: "not_found", message: "No such workspace." });
    const write = await server.inject({
      method: "POST",
      url: "/v1/workspaces/unknown/consents",
      headers: { "x-test-caller": "owner" },
      payload: { kind: "material-storage", action: "granted", basis: "contract" },
    });
    expect(write.statusCode).toBe(404);
  });

  it("is served by the API in owner mode only with a consent ledger", async () => {
    const application = {
      service,
      workspaceRoot: (workspaceId: string) => `/tenants/t/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    };
    app = await buildApi({ ownerToken, application });
    const without = await app.inject({
      method: "GET",
      url: consentsUrl,
      headers: { authorization },
    });
    expect(without.statusCode).toBe(404);
    expect(without.json().error.code).toBe("not_found");
    await app.close();

    app = await buildApi({ ownerToken, application: { ...application, consents: memoryLedger() } });
    const recorded = await app.inject({
      method: "POST",
      url: consentsUrl,
      headers: { authorization },
      payload: { kind: "material-storage", action: "granted", basis: "legitimate-interest" },
    });
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json().recordedBy).toEqual({ kind: "owner" });
    expect((await app.inject({ method: "GET", url: consentsUrl })).statusCode).toBe(401);
  });
});
