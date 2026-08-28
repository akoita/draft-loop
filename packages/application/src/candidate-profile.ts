import { createHash } from "node:crypto";

import {
  type CanonicalCandidateProfile,
  canonicalCandidateProfileSchema,
} from "@draft-loop/schemas";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Freeze a parsed value recursively so application callers cannot retain a mutable pointer. */
function deepFreeze<T>(value: T): T {
  if (!isObject(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

/** Build the strict, provider-independent canonical profile representation. */
export function buildCanonicalCandidateProfile(input: unknown): CanonicalCandidateProfile {
  return deepFreeze(canonicalCandidateProfileSchema.parse(input));
}

/** Return the storage-compatible checksum for a validated canonical profile. */
export function canonicalCandidateProfileChecksum(input: unknown): string {
  const profile = buildCanonicalCandidateProfile(input);
  const serialized = JSON.stringify(canonicalize(profile));
  if (serialized === undefined) throw new Error("The canonical candidate profile is not JSON.");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
