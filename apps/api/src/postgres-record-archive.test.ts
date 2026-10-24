import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordArchiveManifestSchema,
  recordArchiveTableFileSchema,
} from "@draft-loop/schemas/record-archive";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createPostgresTenantDirectory,
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresTenancy,
  type PostgresTenancy,
  type PostgresTenantDirectory,
} from "@draft-loop/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { composeHostedApplication } from "./hosted-application.js";
import { cloudLoggingOptions } from "./logging.js";
import type { TenantApplications } from "./tenant-context.js";
import { readZip } from "./test-zip.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";
const ownerToken = "owner-token-for-tests-0123456789abcdef";
const issuer = "https://id.example.test/realms/draft-loop";
const audience = "draft-loop-api";
const budgetCeiling = { maxRounds: 3, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const tenantId = "org-archive";
const otherTenantId = "org-elsewhere";

/** Fictional career material; each record's carries a marker that is not hex. */
const career = (marker: string) =>
  `# Experience\n\n## Platform Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript services, codenamed ${marker}.\n`;

const people = ["owner", "admin", "coach", "other-coach", "elsewhere"] as const;
type Person = (typeof people)[number];

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

const sha = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

describe.runIf(connectionString !== undefined)("record archives through the API", () => {
  const url = connectionString ?? "";
  const schema = `archive_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  const tokens = {} as Record<Person, string>;
  const logLines: string[] = [];
  let blobRoot: string;
  let tenancy: PostgresTenancy;
  let directory: PostgresTenantDirectory;
  let tenants: TenantApplications;
  let app: FastifyInstance;

  const call = async (
    person: Person,
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: object,
  ) => {
    const response = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${tokens[person]}`, "idempotency-key": randomUUID() },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  const download = (target: FastifyInstance, authorization: string, workspaceId: string) =>
    target.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/archive`,
      headers: { authorization: `Bearer ${authorization}` },
    });

  /** A record created by `person`, with one knowledge base and one source carrying `marker`. */
  const setUpRecord = async (person: Person, workspaceId: string, marker: string) => {
    expect(
      (await call(person, "PUT", `/v1/workspaces/${workspaceId}`, { fixtureMode: true })).status,
    ).toBe(201);
    const base = await call(person, "POST", "/v1/knowledge-bases", {
      displayName: `Career material ${marker}`,
      workspaceId,
    });
    expect(base.status).toBe(201);
    const consent = await call(person, "POST", `/v1/workspaces/${workspaceId}/consents`, {
      kind: "material-storage",
      action: "granted",
      basis: "contract",
      note: `Placement agreement for ${marker}.`,
    });
    expect(consent.status).toBe(201);
    const uploaded = await app.inject({
      method: "POST",
      url: `/v1/knowledge-bases/${base.body.id}/sources?name=career-${marker}.md`,
      headers: { authorization: `Bearer ${tokens[person]}`, "content-type": "text/markdown" },
      payload: career(marker),
    });
    expect(uploaded.statusCode).toBe(201);
  };

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-archive-"));
    tenancy = await openPostgresTenancy({ connectionString: runtimeUrl(url), schema });
    directory = await createPostgresTenantDirectory({ connectionString: runtimeUrl(url), schema });

    const email = (person: Person) => `${person}@archive.example.test`;
    await directory.createOrganisation({
      organisationId: tenantId,
      name: "Example Archive Coaching",
      firstOwnerEmail: email("owner"),
    });
    for (const [person, role] of [
      ["admin", "admin"],
      ["coach", "member"],
      ["other-coach", "member"],
    ] as const) {
      await directory.inviteMember({ organisationId: tenantId, email: email(person), role });
    }
    await directory.createOrganisation({
      organisationId: otherTenantId,
      name: "Example Elsewhere Coaching",
      firstOwnerEmail: email("elsewhere"),
    });

    const signingKey = await generateKeyPair("ES256");
    const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: "key-1", alg: "ES256" };
    for (const person of people) {
      tokens[person] = await new SignJWT({ email: email(person), email_verified: true })
        .setProtectedHeader({ alg: "ES256", kid: "key-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(`subject-${person}`)
        .setExpirationTime("5m")
        .sign(signingKey.privateKey);
    }

    const blobs = createFilesystemBlobStorage();
    tenants = {
      budgetCeiling,
      ownerTenantId: tenantId,
      recordAccessFor: (id) => tenancy.forTenant(id).candidateRecords,
      knowledgeOwnersFor: (id) => tenancy.forTenant(id).knowledgeBaseOwners,
      applicationFor: (id) =>
        composeHostedApplication({
          storage: tenancy.forTenant(id),
          blobs,
          tenantId: id,
          budgetCeiling,
          enqueueRun: async () => undefined,
          knowledgeLocation: (versionId) => join(blobRoot, id, "knowledge", versionId),
        }),
    };
    app = await buildApi({
      ownerToken,
      logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
      auth: {
        mode: "oidc",
        issuer,
        audience,
        webClientId: "draft-loop-web",
        allowHttp: false,
        keys: createLocalJWKSet({ keys: [publicJwk] }),
        resolveSignIn: directory.resolveSignIn,
      },
      tenants,
    });

    // The coach's record and a record only the owner reaches, in one organisation.
    await setUpRecord("coach", "r1", "alder-quill");
    await setUpRecord("owner", "r2", "birch-otter");
  });

  afterAll(async () => {
    await app?.close();
    await directory?.close();
    await tenancy?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    if (blobRoot !== undefined) await rm(blobRoot, { recursive: true, force: true });
  });

  it("gives owners and admins the record's archive and nothing of another record", async () => {
    for (const person of ["owner", "admin"] as const) {
      const response = await download(app, tokens[person], "r1");
      expect(response.statusCode, person).toBe(200);
      expect(response.headers["content-type"]).toBe("application/zip");
      expect(response.headers["content-disposition"]).toBe('attachment; filename="r1-archive.zip"');

      const files = readZip(response.rawPayload);
      const [manifestFile] = files;
      expect(manifestFile?.path).toBe("manifest.json");
      expect(response.headers["x-archive-manifest-sha256"]).toBe(
        sha(manifestFile?.content ?? Buffer.alloc(0)),
      );
      const manifest = recordArchiveManifestSchema.parse(JSON.parse(String(manifestFile?.content)));
      expect(manifest.record).toEqual({ workspaceId: "r1" });
      expect(files.slice(1).map((file) => file.path)).toEqual(
        manifest.entries.map((entry) => entry.path),
      );

      const tables = Object.fromEntries(
        files
          .filter((file) => file.path.startsWith("tables/"))
          .map((file) => {
            const parsed = recordArchiveTableFileSchema.parse(JSON.parse(String(file.content)));
            return [parsed.table, parsed.rows];
          }),
      );
      expect(Object.keys(tables)).toEqual(
        expect.arrayContaining([
          "workspace_settings",
          "consent_events",
          "knowledge_base_owners",
          "candidate_knowledge_bases",
          "candidate_knowledge_sources",
          "candidate_knowledge_source_versions",
          "candidate_knowledge_managed_source_versions",
        ]),
      );
      expect(tables.consent_events).toHaveLength(1);
      expect(tables.candidate_knowledge_bases).toHaveLength(1);
      const objects = files.filter((file) => file.path.startsWith("objects/"));
      expect(objects.map((file) => String(file.content))).toEqual([career("alder-quill")]);

      const everything = files.map((file) => String(file.content)).join("\n");
      expect(everything).toContain("Placement agreement for alder-quill.");
      expect(everything).not.toContain("birch-otter");
      expect(everything).not.toContain("@archive.example.test");
    }

    const audit = logLines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.audit?.action === "record_archive_downloaded");
    expect(audit).toHaveLength(2);
    for (const entry of audit) {
      expect(entry.tenantId).toBe(tenantId);
      expect(entry.audit).toEqual({
        action: "record_archive_downloaded",
        workspaceId: "r1",
        memberId: expect.any(String),
        files: expect.any(Number),
      });
    }
    expect(logLines.join("\n")).not.toContain("alder-quill");
  });

  it("refuses members with 403, records they cannot reach and other tenants with 404", async () => {
    const assigned = await download(app, tokens.coach, "r1");
    expect(assigned.statusCode).toBe(403);
    expect(assigned.json().error.code).toBe("forbidden");
    const unassigned = await download(app, tokens["other-coach"], "r1");
    expect(unassigned.statusCode).toBe(404);
    expect(unassigned.json().error.code).toBe("not_found");
    const unknown = await download(app, tokens.owner, "r9");
    expect(unknown.statusCode).toBe(404);
    const elsewhere = await download(app, tokens.elsewhere, "r1");
    expect(elsewhere.statusCode).toBe(404);
    // The owner token reaches only operator routes in sign-in mode.
    expect((await download(app, ownerToken, "r1")).statusCode).toBe(401);
  });

  it("lets the owner token export in owner-token mode, with every knowledge base of the tenant", async () => {
    const ownerMode = await buildApi({ ownerToken, tenants });
    try {
      const response = await download(ownerMode, ownerToken, "r2");
      expect(response.statusCode).toBe(200);
      const files = readZip(response.rawPayload);
      const objects = files
        .filter((file) => file.path.startsWith("objects/"))
        .map((file) => String(file.content))
        .sort();
      expect(objects).toEqual([career("alder-quill"), career("birch-otter")]);
      // The other record's own rows stay out: only the tenant's bases are shared.
      const text = files.map((file) => String(file.content)).join("\n");
      expect(text).toContain("Placement agreement for birch-otter.");
      expect(text).not.toContain("Placement agreement for alder-quill.");
    } finally {
      await ownerMode.close();
    }
  });

  it("answers 409 archive_integrity when a stored source changed, and sends nothing", async () => {
    const knowledge = join(blobRoot, tenantId, "knowledge");
    for (const name of await readdir(knowledge)) {
      await writeFile(join(knowledge, name), "changed bytes");
    }
    const response = await download(app, tokens.owner, "r1");
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("archive_integrity");
  });
});
