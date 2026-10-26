import { ingestBytes } from "@draft-loop/ingestion";
import { applicationPastedJobMaxLength } from "@draft-loop/schemas/application";

import { CliUserError } from "./cli-user-error.js";
import {
  defaultHostedKnowledgeSourceMaxBytes,
  HostedKnowledgeIntakeError,
  isHostedSourceMediaType,
  matchesHostedSourceMediaType,
} from "./hosted-knowledge-intake.js";

/** A job description file a person attached to a new application. */
export interface JobDescriptionFile {
  /** The file's own name, used only to read it; never stored. */
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * The text of a job description file, read as career evidence is (#1809): a PDF, DOCX, Markdown or
 * plain text file within the source size limit, whose signature matches its type. Both hosts
 * keep this text with the application exactly as pasted text and never store the file, so the
 * brief made from it is handled, and on the hosted service screened, like any pasted job.
 */
export async function jobDescriptionFileText(
  file: JobDescriptionFile,
  maxBytes: number = defaultHostedKnowledgeSourceMaxBytes,
): Promise<string> {
  const { mediaType, bytes } = file;
  if (!isHostedSourceMediaType(mediaType)) {
    throw new HostedKnowledgeIntakeError(
      "unsupported_media_type",
      "Attach a PDF, DOCX, Markdown or plain text file.",
    );
  }
  if (bytes.byteLength === 0) {
    throw new HostedKnowledgeIntakeError("source_empty", "The file is empty.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new HostedKnowledgeIntakeError(
      "source_too_large",
      `The file is larger than the ${maxBytes}-byte limit.`,
    );
  }
  if (!matchesHostedSourceMediaType(bytes, mediaType)) {
    throw new HostedKnowledgeIntakeError(
      "unsupported_media_type",
      "The file's content does not match its type.",
    );
  }
  let text: string | undefined;
  try {
    text = (await ingestBytes({ path: file.name, mediaType }, bytes)).source?.text.trim();
  } catch {
    text = undefined;
  }
  if (text === undefined || text === "") {
    throw new CliUserError("No readable text was found in the file. Paste the job instead.");
  }
  if (text.length > applicationPastedJobMaxLength) {
    throw new CliUserError(
      `The file's text is longer than ${applicationPastedJobMaxLength} characters. Paste the part that describes the job.`,
    );
  }
  return text;
}
