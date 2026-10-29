import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileCredentialResolver, ProviderKeyFileError } from "./file-credentials.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "draft-loop-keys-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function keyFile(provider: string, content: string, mode = 0o600): Promise<void> {
  const path = join(directory, `${provider}_api_key`);
  await writeFile(path, content);
  await chmod(path, mode);
}

const posix = process.platform !== "win32";

describe("createFileCredentialResolver", () => {
  it("reads a provider's key from its file, trimmed, and has no key without a file", async () => {
    await keyFile("openai", "sk-synthetic-1\n");
    const resolve = createFileCredentialResolver({ directory });

    await expect(resolve("openai")).resolves.toBe("sk-synthetic-1");
    await expect(resolve("anthropic")).resolves.toBeUndefined();
  });

  it("keeps a key for its time to live, then reads a replaced file", async () => {
    let at = 0;
    await keyFile("anthropic", "sk-synthetic-1");
    const resolve = createFileCredentialResolver({ directory, ttlMs: 1_000, now: () => at });

    await expect(resolve("anthropic")).resolves.toBe("sk-synthetic-1");
    await keyFile("anthropic", "sk-synthetic-2");
    at = 999;
    await expect(resolve("anthropic")).resolves.toBe("sk-synthetic-1");
    at = 1_000;
    await expect(resolve("anthropic")).resolves.toBe("sk-synthetic-2");
  });

  it("reads a key file added after a call found none", async () => {
    const resolve = createFileCredentialResolver({ directory });

    await expect(resolve("openai")).resolves.toBeUndefined();
    await keyFile("openai", "sk-synthetic-1");
    await expect(resolve("openai")).resolves.toBe("sk-synthetic-1");
  });

  it.runIf(posix)("refuses a key file other users can read, without its content", async () => {
    await keyFile("openai", "sk-synthetic-secret", 0o644);
    const resolve = createFileCredentialResolver({ directory });

    const error = await resolve("openai").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderKeyFileError);
    expect((error as Error).message).toContain("chmod 600");
    expect((error as Error).message).not.toContain("sk-synthetic-secret");
  });

  it("refuses an empty key file and an unreadable one without the system's words", async () => {
    await keyFile("openai", "  \n");
    const resolve = createFileCredentialResolver({ directory });
    await expect(resolve("openai")).rejects.toThrow("The openai key file is empty.");

    // A directory where the file should be cannot be read as a key.
    await rm(join(directory, "openai_api_key"));
    await mkdir(join(directory, "openai_api_key"), { mode: 0o700 });
    const error = await resolve("openai").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderKeyFileError);
    expect((error as Error).message).toBe("The openai key file could not be read.");
  });

  it("never reads outside the directory for an unexpected provider name", async () => {
    const resolve = createFileCredentialResolver({ directory });

    await expect(resolve("../openai")).resolves.toBeUndefined();
    await expect(resolve("")).resolves.toBeUndefined();
  });

  it("needs an absolute directory", () => {
    expect(() => createFileCredentialResolver({ directory: "secrets" })).toThrow(RangeError);
  });
});
