import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  defaultGraniteEmbeddingTier,
  type GraniteEmbeddingModel,
  type GraniteEmbeddingTier,
  type GraniteModelFile,
  getGraniteEmbeddingModel,
  graniteEmbeddingModels,
} from "@draft-loop/embeddings";
import { CliUserError } from "./cli-user-error.js";

/**
 * Explicit install, inspection, and removal of the pinned local embedding model.
 *
 * Nothing here runs implicitly: `install` is the only function that touches the network, and the
 * caller is responsible for showing `planInstall` and obtaining consent first.
 */

export type EmbeddingModelTier = GraniteEmbeddingTier;

/** The installable model sizes, and the one used when none is chosen. */
export const embeddingModelTiers: readonly EmbeddingModelTier[] = Object.freeze(
  Object.keys(graniteEmbeddingModels) as EmbeddingModelTier[],
);
export const defaultEmbeddingModelTier: EmbeddingModelTier = defaultGraniteEmbeddingTier;

export type EmbeddingModelState =
  | "absent"
  | "installing"
  | "ready"
  | "corrupt"
  | "unsupported-platform";

export type EmbeddingModelInstallErrorReason =
  | "checksum-mismatch"
  | "size-mismatch"
  | "http-error"
  | "cancelled"
  | "unsupported-platform"
  | "source-missing"
  | "io-error";

/** A failed install whose message is safe to show as-is; it never contains a local path. */
export class EmbeddingModelInstallError extends CliUserError {
  readonly reason: EmbeddingModelInstallErrorReason;

  constructor(reason: EmbeddingModelInstallErrorReason, message: string) {
    super(message);
    this.name = "EmbeddingModelInstallError";
    this.reason = reason;
  }
}

export interface EmbeddingModelStatus {
  readonly tier: GraniteEmbeddingTier;
  readonly state: EmbeddingModelState;
  readonly modelId: string;
  readonly revision: string;
  readonly license: string;
  readonly totalSizeBytes: number;
  /** The pinned repository page the files come from. */
  readonly sourceUrl: string;
  /** The directory `createOnnxTextEmbedder` receives as `modelDirectory`. */
  readonly modelDirectory: string;
}

export interface EmbeddingModelInstallPlan {
  readonly tier: GraniteEmbeddingTier;
  readonly modelId: string;
  readonly revision: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly files: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly url: string;
  }[];
  readonly totalSizeBytes: number;
  readonly destination: string;
}

export interface EmbeddingModelInstallProgress {
  readonly file: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

export interface EmbeddingModelStatusOptions {
  /** `size` (default) checks file presence and size; `sha256` also re-hashes every file. */
  readonly verify?: "size" | "sha256";
}

export interface EmbeddingModelInstallOptions {
  /** Import the files from this local directory instead of downloading them. */
  readonly from?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EmbeddingModelInstallProgress) => void;
}

export interface EmbeddingModelService {
  status(
    tier: GraniteEmbeddingTier,
    options?: EmbeddingModelStatusOptions,
  ): Promise<EmbeddingModelStatus>;
  planInstall(tier: GraniteEmbeddingTier): EmbeddingModelInstallPlan;
  install(
    tier: GraniteEmbeddingTier,
    options?: EmbeddingModelInstallOptions,
  ): Promise<EmbeddingModelStatus>;
  remove(tier: GraniteEmbeddingTier): Promise<EmbeddingModelStatus>;
}

export interface EmbeddingModelServiceOptions {
  readonly modelRoot: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly platform?: string;
  readonly arch?: string;
  /** Replaces the pinned manifest; tests use a tiny fake. */
  readonly models?: (tier: GraniteEmbeddingTier) => GraniteEmbeddingModel;
}

const modelRootEnvironmentVariable = "DRAFT_LOOP_EMBEDDING_MODEL_ROOT";

/** The per-user model directory; `DRAFT_LOOP_EMBEDDING_MODEL_ROOT` overrides the platform default. */
export function defaultEmbeddingModelRoot(
  input: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly platform?: string;
    readonly homedir?: string;
  } = {},
): string {
  const env = input.env ?? process.env;
  const override = env[modelRootEnvironmentVariable];
  if (override !== undefined && override !== "") return override;
  const platform = input.platform ?? process.platform;
  const home = input.homedir ?? osHomedir();
  if (platform === "win32") {
    const base = nonEmpty(env.LOCALAPPDATA) ?? join(home, "AppData", "Local");
    return join(base, "DraftLoop", "models");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "DraftLoop", "models");
  }
  const base = nonEmpty(env.XDG_DATA_HOME) ?? join(home, ".local", "share");
  return join(base, "draft-loop", "models");
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** `<modelRoot>/<model name>/<revision>`; the directory the runtime loads the model from. */
export function embeddingModelDirectory(
  modelRoot: string,
  tier: GraniteEmbeddingTier,
  models: (tier: GraniteEmbeddingTier) => GraniteEmbeddingModel = getGraniteEmbeddingModel,
): string {
  const model = models(tier);
  const name = model.modelId.split("/").at(-1) ?? model.modelId;
  return join(modelRoot, name, model.revision);
}

const supportedPlatforms: ReadonlyMap<string, readonly string[]> = new Map([
  ["linux", ["x64", "arm64"]],
  ["win32", ["x64", "arm64"]],
  ["darwin", ["arm64"]],
]);

function isSupportedPlatform(platform: string, arch: string): boolean {
  return supportedPlatforms.get(platform)?.includes(arch) ?? false;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function assertWithin(root: string, target: string): void {
  if (!isWithin(root, target)) {
    throw new EmbeddingModelInstallError(
      "io-error",
      "Refusing to touch a location outside the embedding model directory.",
    );
  }
}

function manifestFiles(model: GraniteEmbeddingModel): readonly GraniteModelFile[] {
  return [model.files.model, model.files.tokenizer, model.files.tokenizerConfig];
}

function totalSize(model: GraniteEmbeddingModel): number {
  return manifestFiles(model).reduce((sum, file) => sum + file.sizeBytes, 0);
}

function fileUrl(model: GraniteEmbeddingModel, file: GraniteModelFile): string {
  return `https://huggingface.co/${model.sourceRepository}/resolve/${model.revision}/${file.path}`;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function* readBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  const cancelOnAbort = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    await reader.cancel().catch(() => undefined);
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createEmbeddingModelService(
  options: EmbeddingModelServiceOptions,
): EmbeddingModelService {
  const modelRoot = resolve(options.modelRoot);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const models = options.models ?? getGraniteEmbeddingModel;

  function finalDirectory(tier: GraniteEmbeddingTier): string {
    const directory = embeddingModelDirectory(modelRoot, tier, models);
    assertWithin(modelRoot, directory);
    return directory;
  }

  async function stagingDirectories(tier: GraniteEmbeddingTier): Promise<string[]> {
    const prefix = `.staging-${tier}-`;
    let entries: string[];
    try {
      entries = await readdir(modelRoot);
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => join(modelRoot, entry));
  }

  async function filesVerified(
    model: GraniteEmbeddingModel,
    directory: string,
    verify: "size" | "sha256",
  ): Promise<boolean> {
    for (const file of manifestFiles(model)) {
      const path = join(directory, file.path);
      if (!isWithin(directory, path)) return false;
      if ((await fileSize(path)) !== file.sizeBytes) return false;
      if (verify === "sha256" && (await sha256OfFile(path)) !== file.sha256) return false;
    }
    return true;
  }

  async function status(
    tier: GraniteEmbeddingTier,
    statusOptions: EmbeddingModelStatusOptions = {},
  ): Promise<EmbeddingModelStatus> {
    const model = models(tier);
    const modelDirectory = finalDirectory(tier);
    const base = {
      tier,
      modelId: model.modelId,
      revision: model.revision,
      license: model.license,
      totalSizeBytes: totalSize(model),
      sourceUrl: `https://huggingface.co/${model.sourceRepository}/tree/${model.revision}`,
      modelDirectory,
    };
    if (!isSupportedPlatform(platform, arch)) {
      return { ...base, state: "unsupported-platform" };
    }
    const present = await exists(modelDirectory);
    if (present && (await filesVerified(model, modelDirectory, statusOptions.verify ?? "size"))) {
      return { ...base, state: "ready" };
    }
    if ((await stagingDirectories(tier)).length > 0) return { ...base, state: "installing" };
    return { ...base, state: present ? "corrupt" : "absent" };
  }

  function planInstall(tier: GraniteEmbeddingTier): EmbeddingModelInstallPlan {
    const model = models(tier);
    return {
      tier,
      modelId: model.modelId,
      revision: model.revision,
      license: model.license,
      sourceUrl: `https://huggingface.co/${model.sourceRepository}/tree/${model.revision}`,
      files: manifestFiles(model).map((file) => ({
        path: file.path,
        sizeBytes: file.sizeBytes,
        url: fileUrl(model, file),
      })),
      totalSizeBytes: totalSize(model),
      destination: finalDirectory(tier),
    };
  }

  async function* openSource(
    model: GraniteEmbeddingModel,
    file: GraniteModelFile,
    from: string | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<Uint8Array> {
    if (from !== undefined) {
      const path = resolve(from, file.path);
      if (!isWithin(resolve(from), path) || (await fileSize(path)) === undefined) {
        throw new EmbeddingModelInstallError(
          "source-missing",
          `The import directory does not contain ${file.path}.`,
        );
      }
      for await (const chunk of createReadStream(path)) yield chunk as Buffer;
      return;
    }
    const response = await fetchImpl(fileUrl(model, file), {
      ...(signal === undefined ? {} : { signal }),
      redirect: "follow",
    });
    if (!response.ok) {
      throw new EmbeddingModelInstallError(
        "http-error",
        `Downloading ${file.path} failed with HTTP ${response.status}.`,
      );
    }
    if (response.body === null) {
      throw new EmbeddingModelInstallError(
        "http-error",
        `Downloading ${file.path} returned an empty response.`,
      );
    }
    yield* readBody(response.body, signal);
  }

  async function writeVerifiedFile(
    model: GraniteEmbeddingModel,
    file: GraniteModelFile,
    destination: string,
    installOptions: EmbeddingModelInstallOptions,
  ): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const hash = createHash("sha256");
    let received = 0;
    const handle = await open(destination, "w");
    try {
      for await (const chunk of openSource(
        model,
        file,
        installOptions.from,
        installOptions.signal,
      )) {
        if (installOptions.signal?.aborted === true) {
          throw new EmbeddingModelInstallError("cancelled", "The install was cancelled.");
        }
        received += chunk.byteLength;
        if (received > file.sizeBytes) {
          throw new EmbeddingModelInstallError(
            "size-mismatch",
            `${file.path} is larger than the pinned size of ${file.sizeBytes} bytes.`,
          );
        }
        hash.update(chunk);
        await handle.write(chunk);
        installOptions.onProgress?.({
          file: file.path,
          receivedBytes: received,
          totalBytes: file.sizeBytes,
        });
      }
    } finally {
      await handle.close();
    }
    if (installOptions.signal?.aborted === true) {
      throw new EmbeddingModelInstallError("cancelled", "The install was cancelled.");
    }
    if (received !== file.sizeBytes) {
      throw new EmbeddingModelInstallError(
        "size-mismatch",
        `${file.path} is ${received} bytes; the pinned size is ${file.sizeBytes} bytes.`,
      );
    }
    if (hash.digest("hex") !== file.sha256) {
      throw new EmbeddingModelInstallError(
        "checksum-mismatch",
        `${file.path} does not match its pinned SHA-256 checksum.`,
      );
    }
  }

  function normalizeInstallError(error: unknown, signal: AbortSignal | undefined): Error {
    if (error instanceof EmbeddingModelInstallError) return error;
    if (signal?.aborted === true || isAbortError(error)) {
      return new EmbeddingModelInstallError("cancelled", "The install was cancelled.");
    }
    const code = errorCode(error);
    return new EmbeddingModelInstallError(
      "io-error",
      `Installing the embedding model failed${code === undefined ? "" : ` (${code})`}.`,
    );
  }

  async function install(
    tier: GraniteEmbeddingTier,
    installOptions: EmbeddingModelInstallOptions = {},
  ): Promise<EmbeddingModelStatus> {
    const model = models(tier);
    const destination = finalDirectory(tier);
    if (!isSupportedPlatform(platform, arch)) {
      throw new EmbeddingModelInstallError(
        "unsupported-platform",
        `The local embedding runtime is not available for ${platform}/${arch}.`,
      );
    }
    const current = await status(tier);
    if (current.state === "ready") return current;

    for (const stale of await stagingDirectories(tier)) {
      assertWithin(modelRoot, stale);
      await rm(stale, { recursive: true, force: true });
    }
    await mkdir(modelRoot, { recursive: true });
    const staging = join(modelRoot, `.staging-${tier}-${randomBytes(6).toString("hex")}`);
    assertWithin(modelRoot, staging);
    await mkdir(staging);
    try {
      for (const file of manifestFiles(model)) {
        const target = join(staging, file.path);
        if (!isWithin(staging, target)) {
          throw new EmbeddingModelInstallError("io-error", "The model manifest is invalid.");
        }
        await writeVerifiedFile(model, file, target, installOptions);
      }
      await mkdir(dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw normalizeInstallError(error, installOptions.signal);
    }
    return status(tier);
  }

  async function remove(tier: GraniteEmbeddingTier): Promise<EmbeddingModelStatus> {
    const destination = finalDirectory(tier);
    for (const stale of await stagingDirectories(tier)) {
      assertWithin(modelRoot, stale);
      await rm(stale, { recursive: true, force: true });
    }
    await rm(destination, { recursive: true, force: true });
    const parent = dirname(destination);
    if (isWithin(modelRoot, parent)) await rmdir(parent).catch(() => undefined);
    return status(tier);
  }

  return { status, planInstall, install, remove };
}
