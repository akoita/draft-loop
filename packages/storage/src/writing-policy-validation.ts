import { createHash } from "node:crypto";
import { validateWritingPolicyInput, type WritingPolicy } from "@draft-loop/domain";
import { writingPolicySchema } from "@draft-loop/schemas";
import { StorageValidationError } from "./storage-errors.js";

export function validatedWritingPolicy(value: unknown): WritingPolicy {
  const parsed = writingPolicySchema.safeParse(value);
  if (!parsed.success) {
    throw new StorageValidationError("Writing policy data is invalid.");
  }
  const domainValidation = validateWritingPolicyInput(parsed.data);
  if (!domainValidation.valid) {
    throw new StorageValidationError("Writing policy data is invalid.");
  }
  const normalizedChecksum = parsed.data.checksum.toLowerCase();
  if (
    createHash("sha256").update(parsed.data.content, "utf8").digest("hex") !== normalizedChecksum
  ) {
    throw new StorageValidationError("The writing policy content checksum is invalid.");
  }
  const preferences = parsed.data.preferences;
  return {
    schemaVersion: parsed.data.schemaVersion,
    content: parsed.data.content,
    checksum: normalizedChecksum,
    version: parsed.data.version,
    ...(parsed.data.rules === undefined ? {} : { rules: parsed.data.rules }),
    ...(preferences === undefined
      ? {}
      : {
          preferences: {
            ...(preferences.tone === undefined ? {} : { tone: preferences.tone }),
            ...(preferences.spellingLocale === undefined
              ? {}
              : { spellingLocale: preferences.spellingLocale }),
            ...(preferences.verbosity === undefined ? {} : { verbosity: preferences.verbosity }),
            ...(preferences.pageTarget === undefined ? {} : { pageTarget: preferences.pageTarget }),
            ...(preferences.sectionOrder === undefined
              ? {}
              : { sectionOrder: preferences.sectionOrder }),
            ...(preferences.emphasisAreas === undefined
              ? {}
              : { emphasisAreas: preferences.emphasisAreas }),
          },
        }),
    lineage: parsed.data.lineage ?? { kind: "workspace" },
  };
}
