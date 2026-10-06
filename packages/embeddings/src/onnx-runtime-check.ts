import { loadOnnxRuntime, type OnnxRuntimeModule } from "./onnx-runtime-loader.js";

/** ONNX Identity model: input `x` float32 [1,4] to output `y`. */
const identityModelBase64 =
  "CAgSCmRyYWZ0LWxvb3A6TQoQCgF4EgF5IghJZGVudGl0eRIPZHJhZnRsb29wLXNtb2tlWhMKAXgSDgoMCAESCAoCCAEKAggEYhMKAXkSDgoMCAESCAoCCAEKAggEQgQKABAN";

export type OnnxRuntimeCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface OnnxRuntimeCheckOptions {
  readonly loadRuntime?: () => Promise<OnnxRuntimeModule>;
}

/**
 * Proves the embedding runtime loads and executes: creates a session from a
 * tiny embedded Identity model, runs it once, and checks the output.
 */
export async function verifyOnnxRuntime(
  options: OnnxRuntimeCheckOptions = {},
): Promise<OnnxRuntimeCheckResult> {
  try {
    const ort = await (options.loadRuntime ?? loadOnnxRuntime)();
    const session = await ort.InferenceSession.create(Buffer.from(identityModelBase64, "base64"));
    try {
      const input = Float32Array.from([1, 2, 3, 4]);
      const outputs = await session.run({ x: new ort.Tensor("float32", input, [1, 4]) });
      const output = outputs.y?.data as ArrayLike<number> | undefined;
      if (output === undefined || output.length !== input.length) {
        return { ok: false, reason: "The ONNX runtime self-check returned no output." };
      }
      for (const [index, value] of input.entries()) {
        if (output[index] !== value) {
          return { ok: false, reason: "The ONNX runtime self-check returned a wrong output." };
        }
      }
      return { ok: true };
    } finally {
      await session.release();
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The ONNX runtime self-check failed.",
    };
  }
}
