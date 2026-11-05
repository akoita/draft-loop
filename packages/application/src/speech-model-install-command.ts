import { isAbsolute } from "node:path";
import process from "node:process";

import { installSpeechModel, whisperBaseSpeechModel } from "./speech-model.js";

/**
 * Fetches the pinned speech model into a folder: `pnpm speech-model:install <folder>`. The api
 * image runs it at build time; an operator can run it for a server started from a clone.
 */
const root = process.argv[2] ?? process.env.DRAFT_LOOP_SPEECH_MODEL_DIR ?? "";
if (!isAbsolute(root)) {
  console.error("Give an absolute folder: pnpm speech-model:install /path/to/speech-models");
  process.exit(1);
}
await installSpeechModel(root, whisperBaseSpeechModel, { log: (line) => console.info(line) });
console.info(`${whisperBaseSpeechModel.id} ${whisperBaseSpeechModel.revision} is ready in ${root}`);
