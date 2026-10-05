import { stat } from "node:fs/promises";

import { CliUserError } from "./cli-user-error.js";

export async function ensureDirectory(path: string, label: string): Promise<void> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(path);
  } catch {
    throw new CliUserError(`${label} does not exist: ${path}`);
  }
  if (!details.isDirectory()) {
    throw new CliUserError(`${label} is not a directory: ${path}`);
  }
}

export async function ensureFile(path: string, label: string): Promise<void> {
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(path);
  } catch {
    throw new CliUserError(`${label} does not exist: ${path}`);
  }
  if (!details.isFile()) {
    throw new CliUserError(`${label} is not a file: ${path}`);
  }
}
