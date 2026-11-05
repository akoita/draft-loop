import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The pinned speech-to-text model the web screen runs in the browser (#1030, #2199): Whisper base,
 * multilingual, quantized, as ONNX files for transformers.js. The server serves these exact files
 * from its own origin, so the browser reaches only the DraftLoop server, and refuses any file whose
 * bytes differ from the pin. Audio never leaves the browser; only these files travel, once.
 */

export interface SpeechModelFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface SpeechModel {
  /** The name the browser asks for, and the folder the files sit in under their revision. */
  readonly id: "whisper-base";
  readonly sourceRepository: string;
  readonly revision: string;
  readonly license: "Apache-2.0";
  /** The weight type transformers.js loads, which picks the `_quantized` files below. */
  readonly dtype: "q8";
  readonly files: readonly SpeechModelFile[];
}

export const whisperBaseSpeechModel: SpeechModel = Object.freeze({
  id: "whisper-base",
  sourceRepository: "onnx-community/whisper-base",
  revision: "27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c",
  license: "Apache-2.0",
  dtype: "q8",
  files: Object.freeze(
    [
      {
        path: "config.json",
        sizeBytes: 2_243,
        sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b",
      },
      {
        path: "generation_config.json",
        sizeBytes: 3_832,
        sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0",
      },
      {
        path: "preprocessor_config.json",
        sizeBytes: 339,
        sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
      },
      {
        path: "tokenizer.json",
        sizeBytes: 2_480_466,
        sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
      },
      {
        path: "tokenizer_config.json",
        sizeBytes: 282_682,
        sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573",
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        sizeBytes: 23_201_314,
        sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46",
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        sizeBytes: 53_693_315,
        sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b",
      },
    ].map((file) => Object.freeze(file)),
  ),
});

/** Where a model's files sit under a speech model folder: `<id>/<revision>/<path>`. */
export function speechModelFilePath(root: string, model: SpeechModel, file: SpeechModelFile) {
  return join(root, model.id, model.revision, file.path);
}

/** The pinned file at a path the browser asked for, or undefined for any other path. */
export function speechModelFile(model: SpeechModel, path: string): SpeechModelFile | undefined {
  return model.files.find((file) => file.path === path);
}

export type SpeechModelFileState = "ready" | "absent" | "corrupt";

/** Whether a file on disk is the pinned one: its size first, then its SHA-256. */
export async function checkSpeechModelFile(
  root: string,
  model: SpeechModel,
  file: SpeechModelFile,
): Promise<SpeechModelFileState> {
  const path = speechModelFilePath(root, model, file);
  const found = await stat(path).catch(() => undefined);
  if (found === undefined || !found.isFile()) return "absent";
  if (found.size !== file.sizeBytes) return "corrupt";
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex") === file.sha256 ? "ready" : "corrupt";
}

export class SpeechModelInstallError extends Error {
  override readonly name = "SpeechModelInstallError";
}

export interface SpeechModelInstallOptions {
  readonly fetch?: typeof fetch;
  /** Where the files come from; the model hub's pinned revision by default. */
  readonly sourceUrl?: (model: SpeechModel, file: SpeechModelFile) => string;
  readonly log?: (line: string) => void;
}

const hubUrl = (model: SpeechModel, file: SpeechModelFile) =>
  `https://huggingface.co/${model.sourceRepository}/resolve/${model.revision}/${file.path}`;

/**
 * Downloads each pinned file that is not already in place, checks its size and SHA-256, and only
 * then moves it to its path, so a folder never holds a partial or altered file. Nothing runs
 * implicitly: an image build or an operator calls this.
 */
export async function installSpeechModel(
  root: string,
  model: SpeechModel = whisperBaseSpeechModel,
  options: SpeechModelInstallOptions = {},
): Promise<void> {
  const download = options.fetch ?? fetch;
  const source = options.sourceUrl ?? hubUrl;
  for (const file of model.files) {
    if ((await checkSpeechModelFile(root, model, file)) === "ready") continue;
    const target = speechModelFilePath(root, model, file);
    const response = await download(source(model, file));
    if (!response.ok) {
      throw new SpeechModelInstallError(
        `${file.path} could not be downloaded (${response.status}).`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== file.sizeBytes || sha256 !== file.sha256) {
      throw new SpeechModelInstallError(`${file.path} does not match its pinned size and SHA-256.`);
    }
    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, target).catch(async (error: unknown) => {
      await rm(partial, { force: true });
      throw error;
    });
    options.log?.(`${file.path}: ${file.sizeBytes} bytes, checked`);
  }
}
