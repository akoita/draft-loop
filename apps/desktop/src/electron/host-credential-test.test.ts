import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapabilityPort } from "@draft-loop/ui/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialTestModels } from "./credential-test-host.js";
import { createMemoryCredentialStore, createNativeHost } from "./host.js";

const anthropicKey = "sk-ant-api03-fictional-host-key";
const openaiKey = "sk-proj-fictional-host-key";
const checkedAt = Date.parse("2026-10-24T09:30:00.000Z");

let base: string;
let parent: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "draft-loop-credential-test-"));
  parent = join(base, "workspace");
  await mkdir(parent);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A `fetch` that answers every request with one scripted status and never opens a socket. */
function scriptedFetch(status: number, body: unknown = {}) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        text: async () => JSON.stringify(body),
      }) as unknown as Response,
  );
}

function createHost(
  fetchImpl: ReturnType<typeof scriptedFetch>,
  extra: Partial<Parameters<typeof createNativeHost>[0]> = {},
) {
  return createNativeHost({
    credentials: createMemoryCredentialStore(),
    modelDiscovery: { fetch: fetchImpl as unknown as typeof fetch, now: () => checkedAt },
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
    ...extra,
  });
}

type Host = ReturnType<typeof createHost>;

async function saveKeys(host: Host) {
  for (const [provider, apiKey] of [
    ["anthropic", anthropicKey],
    ["openai", openaiKey],
  ] as const) {
    expect(
      await host.invoke({ type: "credential.set", input: { provider, apiKey } }),
    ).toMatchObject({ ok: true });
  }
}

function requestedUrls(fetchImpl: ReturnType<typeof scriptedFetch>): string[] {
  return fetchImpl.mock.calls.map(([url]) => url);
}

describe("credential.test in the native host", () => {
  it("checks the saved key against the open workspace's model with one lookup", async () => {
    const fetchImpl = scriptedFetch(200, { id: "model" });
    const host = createHost(fetchImpl);
    await saveKeys(host);
    expect(
      await host.invoke({
        type: "workspace.create",
        input: { name: "Fictional Workspace", mode: "real" },
      }),
    ).toMatchObject({ ok: true });
    const port = createCapabilityPort(host);

    const anthropic = await port.execute({
      type: "credential.test",
      input: { provider: "anthropic" },
    });
    const openai = await port.execute({ type: "credential.test", input: { provider: "openai" } });

    expect(anthropic).toMatchObject({
      ok: true,
      value: { provider: "anthropic", outcome: "works", providerCode: null },
    });
    expect(openai).toMatchObject({ ok: true, value: { provider: "openai", outcome: "works" } });
    const [anthropicUrl, openaiUrl] = requestedUrls(fetchImpl);
    const anthropicModel = anthropic.ok ? anthropic.value.models[0] : undefined;
    const openaiModel = openai.ok ? openai.value.models[0] : undefined;
    expect(anthropicModel).toBeDefined();
    expect(openaiModel).toBeDefined();
    expect(anthropicUrl).toBe(
      `https://api.anthropic.com/v1/models/${encodeURIComponent(anthropicModel ?? "")}`,
    );
    expect(openaiUrl).toBe(
      `https://api.openai.com/v1/models/${encodeURIComponent(openaiModel ?? "")}`,
    );
    expect(anthropic.ok ? anthropic.value.checkedAt : "").toBe("2026-10-24T09:30:00.000Z");
  });

  it("makes no paid call and sends no workspace or candidate content", async () => {
    const fetchImpl = scriptedFetch(401, {
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    const host = createHost(fetchImpl);
    await saveKeys(host);

    const rejected = await host.invoke({
      type: "credential.test",
      input: { provider: "anthropic" },
    });

    expect(rejected).toEqual({
      ok: true,
      value: {
        provider: "anthropic",
        outcome: "rejected",
        models: [],
        providerCode: null,
        checkedAt: "2026-10-24T09:30:00.000Z",
      },
    });
    expect(JSON.stringify(rejected)).not.toContain(anthropicKey);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models(\/|\?limit=1$)/u);
      expect(url).not.toMatch(/messages|complete|responses|batches/u);
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
    }
  });

  it("reports no network as not checked", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    const host = createHost(fetchImpl as unknown as ReturnType<typeof scriptedFetch>);
    await saveKeys(host);

    expect(
      await host.invoke({ type: "credential.test", input: { provider: "openai" } }),
    ).toMatchObject({ ok: true, value: { provider: "openai", outcome: "unreachable" } });
  });

  it("refuses to test a provider that uses a user session", async () => {
    const fetchImpl = scriptedFetch(200);
    const host = createHost(fetchImpl, {
      providerAuthModeConfiguration: { anthropic: "api-key", openai: "user-session" },
    });

    const refused = await host.invoke({ type: "credential.test", input: { provider: "openai" } });

    expect(refused).toMatchObject({ ok: false, error: { code: "capability-unavailable" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("credentialTestModels", () => {
  it("names each distinct model the pair runs on the provider, author first", () => {
    const pair = {
      author: { company: "anthropic", model: "claude-fictional-author" },
      critic: { company: "anthropic", model: "claude-fictional-critic" },
    };

    expect(credentialTestModels("anthropic", pair)).toEqual([
      "claude-fictional-author",
      "claude-fictional-critic",
    ]);
    expect(credentialTestModels("openai", pair)).toEqual([]);
    expect(credentialTestModels("anthropic", undefined)).toEqual([]);
    expect(
      credentialTestModels("anthropic", {
        author: { company: "anthropic", model: "claude-fictional-author" },
        critic: { company: "anthropic", model: "claude-fictional-author" },
      }),
    ).toEqual(["claude-fictional-author"]);
  });
});
