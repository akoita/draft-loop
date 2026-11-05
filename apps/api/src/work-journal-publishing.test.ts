import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
} from "@draft-loop/application";
import type { WorkJournalService } from "@draft-loop/application/work-journal";
import type { WorkJournalPublisherOptions } from "@draft-loop/application/work-journal-source";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IdempotencyStore } from "./idempotency.js";
import { registerWorkJournalRoutes } from "./work-journal-routes.js";

/** The publisher's options as the route built them, and a stand-in publish. */
const publisher = vi.hoisted(() => ({
  options: [] as unknown[],
  publish: async () => ({ sourceId: "source-1", status: "created" as const }),
}));

vi.mock("@draft-loop/application/work-journal-source", () => ({
  createWorkJournalPublisher: (options: unknown) => {
    publisher.options.push(options);
    return publisher.publish;
  },
}));

const notes = "/v1/workspaces/workspace-1/work-journal/notes";
const noteId = "wjn_placeholder01";
const storedNote = { id: noteId, status: "approved" };

function fakeJournal(): WorkJournalService {
  return {
    record: vi.fn(async () => ({
      status: "validated",
      possible_duplicate_of: [],
      message: "Valid.",
    })),
    list: vi.fn(async () => []),
    listFull: vi.fn(async () => []),
    get: vi.fn(async () => storedNote),
    review: vi.fn(async () => storedNote),
    intake: vi.fn(async () => ({ enabled: false })),
    setIntake: vi.fn(async (_workspaceId: string, enabled: boolean) => ({
      enabled,
      changedAt: "2026-01-01T00:00:00.000Z",
    })),
  } as unknown as WorkJournalService;
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  publisher.options.length = 0;
});

/**
 * The work journal routes over a stand-in journal. Answers are sent as they are, since the
 * stand-in notes are not whole notes; requests are still checked against the route schemas.
 */
function build(options: { readonly knowledge?: boolean; readonly screening?: boolean } = {}) {
  const journal = fakeJournal();
  const idempotency: IdempotencyStore = { once: vi.fn(async (_s, _k, _r, produce) => produce()) };
  const evidenceKinds = { appendCandidateKnowledgeSourceEvidenceKindOverride: vi.fn() };
  const screenUpload = vi.fn(async () => undefined);
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(() => (data) => JSON.stringify(data));
  registerWorkJournalRoutes(server, {
    service: { readWorkspace: async () => ({}) } as unknown as ApplicationService,
    workspaceRoot: (workspaceId) => `root/${workspaceId}`,
    journal,
    idempotency,
    ...(options.knowledge === true
      ? {
          knowledge: {
            intake: {} as HostedKnowledgeIntake,
            rules: {} as HostedSensitivityRules,
            evidenceKinds: evidenceKinds as never,
          },
        }
      : {}),
    ...(options.screening === true ? { screening: { screenUpload } } : {}),
  });
  app = server;
  return { server, journal, idempotency, evidenceKinds, screenUpload };
}

const approve = (server: FastifyInstance) =>
  server.inject({
    method: "POST",
    url: `${notes}/${noteId}/review`,
    payload: { action: "approve", knowledge_base_id: "base-1" },
  });

describe("work journal publishing", () => {
  it("reviews without publishing on a server that keeps no knowledge bases", async () => {
    const { server, journal } = build();

    const response = await approve(server);

    expect(response.statusCode).toBe(200);
    expect(publisher.options).toEqual([]);
    expect(journal.review).toHaveBeenCalledWith(
      "workspace-1",
      noteId,
      { action: "approve", knowledge_base_id: "base-1" },
      undefined,
    );
  });

  it("publishes an approved note, marking its source as work journal evidence", async () => {
    const { server, journal, evidenceKinds } = build({ knowledge: true });

    await approve(server);
    const [options] = publisher.options as WorkJournalPublisherOptions[];
    await options?.setEvidenceKind("base-1", "source-1", "work-journal");

    expect(journal.review).toHaveBeenCalledWith("workspace-1", noteId, expect.anything(), {
      publish: publisher.publish,
    });
    expect(options?.screen).toBeUndefined();
    expect(evidenceKinds.appendCandidateKnowledgeSourceEvidenceKindOverride).toHaveBeenCalledWith(
      "base-1",
      "source-1",
      {
        kind: "work-journal",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      },
    );
  });

  it("screens a published note's source as an upload when screening is on", async () => {
    const { server, screenUpload } = build({ knowledge: true, screening: true });

    await approve(server);
    const [options] = publisher.options as WorkJournalPublisherOptions[];
    const bytes = new TextEncoder().encode("Placeholder note.");
    await options?.screen?.(
      {
        created: true,
        source: { id: "source-1", knowledgeBaseId: "base-1", displayName: "Placeholder note" },
        latestVersion: { id: "version-1", mediaType: "text/markdown" },
      } as never,
      bytes,
    );

    expect(screenUpload).toHaveBeenCalledWith(expect.anything(), {
      knowledgeBaseId: "base-1",
      sourceId: "source-1",
      sourceVersionId: "version-1",
      name: "Placeholder note",
      mediaType: "text/markdown",
      bytes,
    });
  });

  it("records a note without an idempotency key straight through the journal", async () => {
    const { server, journal, idempotency } = build();

    const response = await server.inject({
      method: "POST",
      url: notes,
      payload: { title: "Placeholder" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("review_url");
    expect(journal.record).toHaveBeenCalledWith("workspace-1", { title: "Placeholder" });
    expect(idempotency.once).not.toHaveBeenCalled();
  });

  it("reads one note, and the intake switch with and without a change time", async () => {
    const { server, journal } = build();

    const note = await server.inject({ url: `${notes}/${noteId}` });
    const off = await server.inject({ url: "/v1/workspaces/workspace-1/work-journal/intake" });
    vi.mocked(journal.intake).mockResolvedValueOnce({
      enabled: true,
      changedAt: "2026-01-02T00:00:00.000Z",
    } as never);
    const on = await server.inject({ url: "/v1/workspaces/workspace-1/work-journal/intake" });

    expect(note.json()).toEqual(storedNote);
    expect(journal.get).toHaveBeenCalledWith("workspace-1", noteId);
    expect(off.json()).toEqual({ enabled: false });
    expect(on.json()).toEqual({ enabled: true, changed_at: "2026-01-02T00:00:00.000Z" });
  });

  it("answers an intake change without a change time when the journal gives none", async () => {
    const { server, journal } = build();
    vi.mocked(journal.setIntake).mockResolvedValueOnce({ enabled: false } as never);

    const response = await server.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/work-journal/intake",
      payload: { enabled: false },
    });

    expect(response.json()).toEqual({ enabled: false });
  });
});
