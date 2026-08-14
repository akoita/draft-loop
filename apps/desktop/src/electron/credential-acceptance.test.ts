import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runCredentialAcceptance } from "./credential-acceptance.js";
import { createSafeStorageCredentialStore, type SafeStorageAdapter } from "./host.js";

describe("packaged credential acceptance logic", () => {
  it("records sanitized restart, replace, remove, and precedence evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-credential-evidence-"));
    const filename = join(root, "credentials.json");
    const evidencePath = join(root, "evidence.json");
    const previous = process.env.ANTHROPIC_API_KEY;
    const secrets = {
      initial: `initial-${randomUUID()}`,
      replacement: `replacement-${randomUUID()}`,
      environment: `environment-${randomUUID()}`,
    };
    const safeStorage: SafeStorageAdapter = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "kwallet6",
      encryptString: (plain) => Buffer.from(`encrypted:${plain}`),
      decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/u, ""),
    };
    try {
      await runCredentialAcceptance({
        store: createSafeStorageCredentialStore({ safeStorage, filename }),
        phase: "prepare",
        evidencePath,
        appVersion: "test",
        ...secrets,
      });
      await runCredentialAcceptance({
        store: createSafeStorageCredentialStore({ safeStorage, filename }),
        phase: "verify",
        evidencePath,
        appVersion: "test",
        ...secrets,
      });
      const evidence = await readFile(evidencePath, "utf8");
      expect(JSON.parse(evidence)).toMatchObject({
        schemaVersion: 1,
        appVersion: "test",
        protection: "os-backed",
        checks: {
          restart: true,
          replace: true,
          remove: true,
          appPrecedence: true,
          environmentFallback: true,
        },
      });
      for (const secret of Object.values(secrets)) expect(evidence).not.toContain(secret);
      await expect(readFile(filename, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});
