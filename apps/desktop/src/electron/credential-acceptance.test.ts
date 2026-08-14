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
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOpenai = process.env.OPENAI_API_KEY;
    const secrets = {
      anthropic: {
        initial: `anthropic-initial-${randomUUID()}`,
        replacement: `anthropic-replacement-${randomUUID()}`,
        environment: `anthropic-environment-${randomUUID()}`,
      },
      openai: {
        initial: `openai-initial-${randomUUID()}`,
        replacement: `openai-replacement-${randomUUID()}`,
        environment: `openai-environment-${randomUUID()}`,
      },
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
        safeStorageAvailable: true,
        selectedStorageBackend: "kwallet6",
        credentials: secrets,
      });
      await runCredentialAcceptance({
        store: createSafeStorageCredentialStore({ safeStorage, filename }),
        phase: "verify",
        evidencePath,
        appVersion: "test",
        safeStorageAvailable: true,
        selectedStorageBackend: "kwallet6",
        credentials: secrets,
      });
      const evidence = await readFile(evidencePath, "utf8");
      expect(JSON.parse(evidence)).toMatchObject({
        schemaVersion: 1,
        appVersion: "test",
        electronSafeStorage: { available: true, selectedBackend: "kwallet6" },
        protection: { anthropic: "os-backed", openai: "os-backed" },
        checks: {
          restart: true,
          replace: true,
          remove: true,
          appPrecedence: true,
          environmentFallback: true,
        },
      });
      for (const providerSecrets of Object.values(secrets)) {
        for (const secret of Object.values(providerSecrets)) expect(evidence).not.toContain(secret);
      }
      await expect(readFile(filename, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOpenai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenai;
      await rm(root, { recursive: true, force: true });
    }
  });
});
