import { createRequire } from "node:module";
import { join } from "node:path";

export type OnnxRuntimeModule = typeof import("onnxruntime-node");

export interface OnnxRuntimeLoaderOptions {
  /** Primary loader; defaults to a dynamic import of `onnxruntime-node`. */
  readonly importer?: () => Promise<unknown>;
  /** Loader for the packaged copy under `process.resourcesPath`. */
  readonly resourceLoader?: (resourcesPath: string) => unknown;
  readonly resourcesPath?: string | undefined;
}

export class OnnxRuntimeUnavailableError extends Error {
  override readonly name = "OnnxRuntimeUnavailableError";
}

function unwrap(loaded: unknown): OnnxRuntimeModule {
  const module = loaded as OnnxRuntimeModule & { readonly default?: OnnxRuntimeModule };
  return module.default ?? module;
}

function moduleRequire(): NodeJS.Require {
  try {
    return createRequire(import.meta.url);
  } catch {
    // Electron Forge emits the main bundle as CommonJS, where import.meta.url
    // can be undefined; anchor on an absolute cwd path instead.
    return createRequire(join(process.cwd(), "package.json"));
  }
}

function defaultResourceLoader(resourcesPath: string): unknown {
  return moduleRequire()(join(resourcesPath, "onnxruntime-node"));
}

/**
 * Loads `onnxruntime-node`, falling back to the copy that packaged desktop
 * builds ship under `process.resourcesPath` (the same way better-sqlite3 is
 * shipped). The result is not cached here; use `loadOnnxRuntime`.
 */
export async function loadOnnxRuntimeUncached(
  options: OnnxRuntimeLoaderOptions = {},
): Promise<OnnxRuntimeModule> {
  const importer = options.importer ?? (() => import("onnxruntime-node"));
  try {
    return unwrap(await importer());
  } catch (error) {
    const resourcesPath =
      "resourcesPath" in options
        ? options.resourcesPath
        : (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
    if (resourcesPath === undefined) {
      throw new OnnxRuntimeUnavailableError(
        "The onnxruntime-node embedding runtime could not be loaded.",
        { cause: error },
      );
    }
    try {
      return unwrap((options.resourceLoader ?? defaultResourceLoader)(resourcesPath));
    } catch (fallbackError) {
      throw new OnnxRuntimeUnavailableError(
        "The onnxruntime-node embedding runtime could not be loaded from the application resources.",
        { cause: new AggregateError([error, fallbackError]) },
      );
    }
  }
}

let cached: Promise<OnnxRuntimeModule> | undefined;

export function loadOnnxRuntime(): Promise<OnnxRuntimeModule> {
  cached ??= loadOnnxRuntimeUncached().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
