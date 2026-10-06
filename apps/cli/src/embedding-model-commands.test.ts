import { describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  type EmbeddingModelInstallPlan,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
} from "./workflow.js";

const plan: EmbeddingModelInstallPlan = {
  tier: "311m",
  modelId: "example-org/fake-embedding-r2",
  revision: "0123456789abcdef0123456789abcdef01234567",
  license: "Apache-2.0",
  sourceUrl: "https://huggingface.co/example-org/fake-ONNX/tree/0123",
  files: [
    { path: "onnx/model_int8.onnx", sizeBytes: 300_000_000, url: "https://example.test/model" },
    { path: "tokenizer.json", sizeBytes: 13_000_000, url: "https://example.test/tokenizer" },
  ],
  totalSizeBytes: 313_000_000,
  destination: "/models/fake/0123",
};

function statusFor(
  tier: "311m" | "97m",
  state: EmbeddingModelStatus["state"],
): EmbeddingModelStatus {
  return {
    tier,
    state,
    modelId: plan.modelId,
    revision: plan.revision,
    license: plan.license,
    totalSizeBytes: plan.totalSizeBytes,
    sourceUrl: plan.sourceUrl,
    modelDirectory: plan.destination,
  };
}

function setup() {
  const lines: string[] = [];
  const service = {
    status: vi.fn(async (tier) => statusFor(tier, "absent")),
    planInstall: vi.fn(() => plan),
    install: vi.fn(async (tier, options) => {
      options?.onProgress?.({ file: "tokenizer.json", receivedBytes: 1, totalBytes: 100 });
      options?.onProgress?.({ file: "tokenizer.json", receivedBytes: 5, totalBytes: 100 });
      options?.onProgress?.({ file: "tokenizer.json", receivedBytes: 10, totalBytes: 100 });
      options?.onProgress?.({ file: "tokenizer.json", receivedBytes: 100, totalBytes: 100 });
      return statusFor(tier, "ready");
    }),
    remove: vi.fn(async (tier) => statusFor(tier, "absent")),
  } satisfies EmbeddingModelService;
  const factory = vi.fn((_modelRoot: string) => service);
  const cli = createCli({
    service: {} as ApplicationService,
    embeddingModelServiceFactory: factory,
    io: { write: (line: string) => lines.push(line) },
  });
  cli.exitOverride();
  const run = (...args: string[]) => cli.parseAsync(["node", "draft-loop", "embeddings", ...args]);
  return { service, factory, lines, run };
}

describe("embeddings CLI", () => {
  it("prints the plan and downloads nothing without --confirm", async () => {
    const { service, factory, lines, run } = setup();
    await run("install", "--model-dir", "/custom");
    expect(factory).toHaveBeenCalledWith("/custom");
    expect(service.install).not.toHaveBeenCalled();
    const output = lines.join("\n");
    expect(output).toContain(plan.sourceUrl);
    expect(output).toContain("total size: 313.0 MB");
    expect(output).toContain("license: Apache-2.0");
    expect(output).toContain("destination: /models/fake/0123");
    expect(lines.at(-1)).toBe(
      "Nothing was downloaded. Re-run with --confirm to install the model.",
    );
  });

  it("installs with --confirm, printing throttled progress and the final status", async () => {
    const { service, lines, run } = setup();
    await run("install", "--confirm", "--tier", "97m", "--model-dir", "/custom");
    expect(service.install).toHaveBeenCalledWith("97m", expect.objectContaining({}));
    expect(service.install.mock.calls[0]?.[1]).not.toHaveProperty("from");
    const progress = lines.filter((line) => line.startsWith("  tokenizer.json:"));
    expect(progress).toEqual([
      "  tokenizer.json: 0%",
      "  tokenizer.json: 10%",
      "  tokenizer.json: 100%",
    ]);
    expect(lines).toContain("embedding model 97m: ready");
  });

  it("passes --from for an offline import", async () => {
    const { service, run } = setup();
    await run("install", "--confirm", "--from", "/offline");
    expect(service.install).toHaveBeenCalledWith(
      "311m",
      expect.objectContaining({ from: "/offline" }),
    );
  });

  it("reports status with the size check by default and sha256 with --verify", async () => {
    const { service, lines, run } = setup();
    await run("status", "--model-dir", "/custom");
    expect(service.status).toHaveBeenLastCalledWith("311m", { verify: "size" });
    expect(lines[0]).toBe("embedding model 311m: absent");
    await run("status", "--tier", "97m", "--verify");
    expect(service.status).toHaveBeenLastCalledWith("97m", { verify: "sha256" });
  });

  it("removes the model", async () => {
    const { service, lines, run } = setup();
    await run("remove", "--model-dir", "/custom");
    expect(service.remove).toHaveBeenCalledWith("311m");
    expect(lines[0]).toBe("embedding model 311m: absent");
  });

  it("rejects an unknown tier as a user error", async () => {
    const { service, run } = setup();
    for (const command of ["status", "install", "remove"]) {
      const failure = await run(command, "--tier", "huge").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CliUserError);
      expect((failure as Error).message).toBe("--tier must be one of: 311m, 97m.");
    }
    expect(service.install).not.toHaveBeenCalled();
  });
});
