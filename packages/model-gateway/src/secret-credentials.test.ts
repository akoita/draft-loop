import { describe, expect, it, vi } from "vitest";

import {
  createSecretManagerCredentialResolver,
  ProviderCredentialError,
  type SecretVersionReader,
} from "./secret-credentials.js";

const openaiSecret = "projects/synthetic-project/secrets/openai-key/versions/latest";

function reader(values: (string | Error)[]): SecretVersionReader & {
  accessSecretVersion: ReturnType<typeof vi.fn>;
} {
  const queue = [...values];
  return {
    accessSecretVersion: vi.fn(async () => {
      const next = queue.shift() ?? new Error("no more values");
      if (next instanceof Error) throw next;
      return [{ payload: { data: new TextEncoder().encode(`${next}\n`) } }] as const;
    }),
  };
}

describe("createSecretManagerCredentialResolver", () => {
  it("reads a listed provider's key from its secret version and has no key for others", async () => {
    const client = reader(["sk-synthetic-1"]);
    const resolve = createSecretManagerCredentialResolver({
      secrets: { openai: openaiSecret },
      client,
    });

    await expect(resolve("openai")).resolves.toBe("sk-synthetic-1");
    await expect(resolve("anthropic")).resolves.toBeUndefined();
    expect(client.accessSecretVersion).toHaveBeenCalledExactlyOnceWith({ name: openaiSecret });
  });

  it("keeps a key for its time to live, shares concurrent reads, then reads a rotated key", async () => {
    let at = 0;
    const client = reader(["sk-synthetic-1", "sk-synthetic-2"]);
    const resolve = createSecretManagerCredentialResolver({
      secrets: { openai: openaiSecret },
      client,
      ttlMs: 1000,
      now: () => at,
    });

    await expect(Promise.all([resolve("openai"), resolve("openai")])).resolves.toEqual([
      "sk-synthetic-1",
      "sk-synthetic-1",
    ]);
    at = 999;
    await expect(resolve("openai")).resolves.toBe("sk-synthetic-1");
    at = 1000;
    await expect(resolve("openai")).resolves.toBe("sk-synthetic-2");
    expect(client.accessSecretVersion).toHaveBeenCalledTimes(2);
  });

  it("fails without the secret's value or the client's error, and does not cache the failure", async () => {
    const client = reader([
      new Error("permission denied on sk-leaked-value"),
      "",
      "sk-synthetic-3",
    ]);
    const resolve = createSecretManagerCredentialResolver({
      secrets: { openai: openaiSecret },
      client,
    });

    const failure = await resolve("openai").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderCredentialError);
    expect(String(failure)).toBe(
      "ProviderCredentialError: The openai key could not be read from Secret Manager.",
    );
    expect(JSON.stringify(failure)).not.toContain("sk-");
    await expect(resolve("openai")).rejects.toThrow(ProviderCredentialError);
    await expect(resolve("openai")).resolves.toBe("sk-synthetic-3");
  });

  it.each(["openai-key", "projects/p/secrets/openai-key", "projects/p/secrets/a b/versions/1"])(
    "refuses a secret that is not a version name: %s",
    (name) => {
      expect(() => createSecretManagerCredentialResolver({ secrets: { openai: name } })).toThrow(
        RangeError,
      );
    },
  );
});
