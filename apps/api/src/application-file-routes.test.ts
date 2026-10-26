import type { ApplicationService, ApplicationView } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-26T00:00:00.000Z";
const root = "/tenants/owner/workspaces/workspace-1";
const route = "/v1/workspaces/workspace-1/applications/from-file";
const job = "Platform Engineer at Example Ledger. Build TypeScript services.";

const created = {
  schemaVersion: 1,
  id: "app-platform",
  name: "Example Ledger platform engineer",
  jobSource: { kind: "stored-text", text: job },
  createdAt: at,
  updatedAt: at,
  status: "drafting",
  isDefault: false,
  briefs: [],
  runs: [],
  exports: [],
  archivedAt: null,
  nameChosen: true,
  suggestedName: null,
  modelProfiles: null,
  chosenRun: null,
} as unknown as ApplicationView;

const encode = (text: string) => new TextEncoder().encode(text);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function littleEndian(value: number, length: number): Uint8Array {
  const result = new Uint8Array(length);
  for (let index = 0, rest = value >>> 0; index < length; index += 1, rest >>>= 8) {
    result[index] = rest & 0xff;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A one-entry stored (uncompressed) DOCX holding a fictional job. */
function docx(text: string): Uint8Array {
  const name = encode("word/document.xml");
  const content = encode(
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const sizes = [littleEndian(crc32(content), 4), littleEndian(content.length, 4)];
  const local = concat(
    Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
    littleEndian(20, 2),
    new Uint8Array(8),
    sizes[0] as Uint8Array,
    sizes[1] as Uint8Array,
    sizes[1] as Uint8Array,
    littleEndian(name.length, 2),
    new Uint8Array(2),
    name,
    content,
  );
  const central = concat(
    Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
    littleEndian(20, 2),
    littleEndian(20, 2),
    new Uint8Array(8),
    sizes[0] as Uint8Array,
    sizes[1] as Uint8Array,
    sizes[1] as Uint8Array,
    littleEndian(name.length, 2),
    new Uint8Array(12),
    littleEndian(0, 4),
    name,
  );
  const end = concat(
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    new Uint8Array(4),
    littleEndian(1, 2),
    littleEndian(1, 2),
    littleEndian(central.length, 4),
    littleEndian(local.length, 4),
    new Uint8Array(2),
  );
  return concat(local, central, end);
}

function pdf(text: string): Uint8Array {
  return encode(
    `%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT\n/F1 10 Tf\n(${text}) Tj\nET\nendstream\nendobj\n%%EOF`,
  );
}

/** Only the methods a test scripts exist; calling any other one fails the test. */
function scriptedService(methods: Partial<ApplicationService>): ApplicationService {
  return new Proxy(methods, {
    get: (target, name) =>
      (target as Record<string | symbol, unknown>)[name] ??
      (() => {
        throw new Error(`unexpected service call: ${String(name)}`);
      }),
  }) as ApplicationService;
}

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: scriptedService(methods),
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

const upload = (contentType: string, payload: Uint8Array, fileName = "job") =>
  app.inject({
    method: "POST",
    url: `${route}?name=${encodeURIComponent("Example Ledger platform engineer")}&fileName=${fileName}`,
    headers: { authorization, "content-type": contentType },
    payload: Buffer.from(payload),
  });

afterEach(async () => {
  await app.close();
});

describe("an application from a job description file (#1809)", () => {
  it.each([
    ["text/plain", encode(`${job}\n`), job],
    ["text/markdown", encode(`# Platform Engineer\n\n${job}\n`), `# Platform Engineer\n\n${job}`],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx(job), job],
    ["application/pdf", pdf(job), job],
  ])("keeps the text of a %s file as the application's pasted job", async (type, bytes, text) => {
    const createApplication = vi.fn(async () => created);
    await build({ createApplication });

    const response = await upload(type, bytes);

    expect(response.statusCode).toBe(201);
    expect(createApplication).toHaveBeenCalledWith({
      root,
      name: "Example Ledger platform engineer",
      jobSource: { kind: "pasted-text", text },
    });
    expect(response.json()).toMatchObject({ id: "app-platform", jobSourceKind: "pasted-text" });
  });

  it("refuses another type, a mismatched signature, an empty file and one without text", async () => {
    await build({});

    expect((await upload("image/png", Uint8Array.of(0x89, 0x50))).statusCode).toBe(415);
    expect((await upload("application/pdf", encode(job))).statusCode).toBe(415);
    expect((await upload("text/plain", new Uint8Array(0))).statusCode).toBe(400);
    const blank = await upload("text/plain", encode("   \n\n  "));
    expect(blank.statusCode).toBe(422);
    expect(blank.json()).toMatchObject({ error: { code: "rejected" } });
  });

  it("refuses a file name with a path and a file over the upload limit", async () => {
    await build({});

    expect((await upload("text/plain", encode(job), "..%2Fjob.txt")).statusCode).toBe(400);
    expect(
      (await upload("text/plain", new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61))).statusCode,
    ).toBe(413);
  });
});
