import type { JsonObject } from "@draft-loop/providers";
import { ProviderAdapterError } from "@draft-loop/providers";

import type { CanonicalCandidateProfileExtractionSource } from "./candidate-profile-extraction.js";
import {
  type CanonicalProfileExtractionControls,
  type CanonicalProfileExtractionExecutor,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";
import { createCanonicalProfileExtractionPartCache } from "./canonical-profile-extraction-parts.js";
import { canonicalProfileExtractionWindowCharacters } from "./canonical-profile-extraction-size-windows.js";

/** The two synthetic career styles the window ratio is checked against. */
export type ProfileWindowLiveCheckTextKind = "dense" | "prose";

// Above the 65,536-unit unplanned bound, so extraction plans windows instead of one call.
export const profileWindowLiveCheckCharacters = 70_000;

const companies = [
  "Northwind Analytics",
  "Bluefjord Logistics",
  "Copperleaf Insurance",
  "Halcyon Payments",
  "Meridian Grid Systems",
  "Quillstone Health",
  "Ridgeway Retail Labs",
  "Tidewater Energy Data",
];
const titles = [
  "Senior Backend Engineer",
  "Tech Lead",
  "Staff Software Engineer",
  "Platform Engineer",
  "Data Engineer",
  "Engineering Manager",
];
const technologies = [
  "Java 21",
  "Kotlin",
  "Go",
  "TypeScript",
  "PostgreSQL",
  "Kafka",
  "Kubernetes",
  "Terraform",
  "GCP BigQuery",
  "AWS Lambda",
  "Redis",
  "gRPC",
  "Spring Boot",
  "dbt",
  "OpenTelemetry",
];
const verbs = [
  "Led",
  "Designed",
  "Migrated",
  "Rebuilt",
  "Automated",
  "Introduced",
  "Scaled",
  "Hardened",
];
const objects = [
  "the settlement ledger service",
  "the order routing pipeline",
  "the claims ingestion platform",
  "the customer identity service",
  "the nightly risk aggregation batch",
  "the metering data lake",
  "the release pipeline",
  "the on-call and incident review process",
];

function pick<T>(values: readonly T[], seed: number): T {
  return values[seed % values.length] as T;
}

function denseBullet(seed: number): string {
  const percent = 10 + ((seed * 7) % 80);
  const team = 3 + (seed % 9);
  return `- ${pick(verbs, seed)} ${pick(objects, seed * 3 + 1)} with ${pick(technologies, seed * 5 + 2)} and ${pick(technologies, seed * 11 + 3)}, cutting p95 latency by ${percent}% for a team of ${team} engineers.`;
}

function proseSentence(seed: number): string {
  const months = 4 + (seed % 20);
  return `Over ${months} months I ${pick(verbs, seed).toLowerCase()} ${pick(objects, seed * 3 + 1)}, working with product and operations to agree the scope, and chose ${pick(technologies, seed * 5 + 2)} because the existing ${pick(technologies, seed * 11 + 3)} setup could not meet the reliability targets.`;
}

/**
 * Deterministic, made-up career text of about the requested length: no real person, employer or
 * claim. Dense text is role sections of short bullets; prose is the same roles as paragraphs.
 */
export function syntheticCareerText(
  kind: ProfileWindowLiveCheckTextKind,
  characters: number = profileWindowLiveCheckCharacters,
): string {
  const parts: string[] = ["# Alex Example, synthetic career record\n\n"];
  let length = parts[0]?.length ?? 0;
  let seed = 0;
  for (let role = 0; length < characters; role += 1) {
    const start = 2006 + (role % 18);
    const heading = `## ${pick(titles, role)} at ${pick(companies, role)} (${start} to ${start + 1 + (role % 3)})\n\n`;
    parts.push(heading);
    length += heading.length;
    for (let line = 0; line < 12 && length < characters; line += 1) {
      seed += 1;
      const text = kind === "dense" ? `${denseBullet(seed)}\n` : `${proseSentence(seed)} `;
      parts.push(text);
      length += text.length;
    }
    parts.push("\n\n");
    length += 2;
  }
  return parts.join("");
}

/** One provider call made during the check, without any request or response text. */
export interface ProfileWindowLiveCheckCall {
  readonly kind: ProfileWindowLiveCheckTextKind;
  readonly sourceCharacters: number;
  readonly durationMs: number;
  readonly outcome: "ok" | "output-limit" | "error";
  readonly outputTokens: number | null;
  readonly outputTokensPerCharacter: number | null;
}

export interface ProfileWindowLiveCheckTextResult {
  readonly kind: ProfileWindowLiveCheckTextKind;
  readonly sourceCharacters: number;
  readonly durationMs: number;
  readonly completed: boolean;
  readonly factCount: number | null;
  readonly calls: readonly ProfileWindowLiveCheckCall[];
}

export interface ProfileWindowLiveCheckResult {
  readonly company: string;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly windowCharacters: number;
  readonly texts: readonly ProfileWindowLiveCheckTextResult[];
  readonly outputLimitCalls: number;
  readonly maximumOutputTokensPerCharacter: number | null;
  /** True when every text completed and no planned-size call hit the output limit. */
  readonly passed: boolean;
}

function isOutputLimit(error: unknown): boolean {
  return (
    error instanceof ProviderAdapterError &&
    error.code === "invalid-response" &&
    (error.failureStage === "output-token-budget-exceeded" ||
      error.diagnostics.some((diagnostic) => diagnostic.code === "max_tokens") ||
      error.diagnosticCounts.some((diagnostic) => diagnostic.code === "max_tokens"))
  );
}

function requestSourceCharacters(input: JsonObject): number {
  const sources = input.sources;
  if (!Array.isArray(sources)) return 0;
  return sources.reduce<number>((total, source) => {
    const text = (source as { text?: unknown } | null)?.text;
    return total + (typeof text === "string" ? text.length : 0);
  }, 0);
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Extract a profile from each synthetic text through the planned-window path, recording each
 * provider call's source size, duration, outcome and output tokens.
 */
export async function runProfileWindowLiveCheck(input: {
  readonly executor: CanonicalProfileExtractionExecutor;
  readonly controls: Omit<CanonicalProfileExtractionControls, "partCache">;
  readonly characters?: number;
  readonly now?: () => number;
}): Promise<ProfileWindowLiveCheckResult> {
  const now = input.now ?? (() => performance.now());
  const texts: ProfileWindowLiveCheckTextResult[] = [];
  for (const kind of ["dense", "prose"] as const) {
    const text = syntheticCareerText(kind, input.characters);
    const calls: ProfileWindowLiveCheckCall[] = [];
    const executor: CanonicalProfileExtractionExecutor = {
      execute: async (request) => {
        const sourceCharacters = requestSourceCharacters(request.input);
        const started = now();
        try {
          const response = await input.executor.execute(request);
          const outputTokens = response.usage.outputTokens;
          calls.push({
            kind,
            sourceCharacters,
            durationMs: Math.round(now() - started),
            outcome: "ok",
            outputTokens,
            outputTokensPerCharacter:
              sourceCharacters === 0 ? null : round(outputTokens / sourceCharacters),
          });
          return response;
        } catch (error) {
          calls.push({
            kind,
            sourceCharacters,
            durationMs: Math.round(now() - started),
            outcome: isOutputLimit(error) ? "output-limit" : "error",
            outputTokens: null,
            outputTokensPerCharacter: null,
          });
          throw error;
        }
      },
    };
    const source: CanonicalCandidateProfileExtractionSource = {
      id: `synthetic-${kind}`,
      mediaType: "text/markdown",
      checksum: `synthetic-${kind}-${text.length}`,
      text,
    };
    const started = now();
    let factCount: number | null = null;
    let completed = false;
    try {
      const output = await executeCanonicalProfileExtractionWithFallback(
        executor,
        { operationId: `profile-window-live-check-${kind}`, sources: [source] },
        { ...input.controls, partCache: createCanonicalProfileExtractionPartCache() },
      );
      completed = true;
      factCount = Array.isArray(output.facts) ? output.facts.length : null;
    } catch {
      completed = false;
    }
    texts.push({
      kind,
      sourceCharacters: text.length,
      durationMs: Math.round(now() - started),
      completed,
      factCount,
      calls,
    });
  }

  const calls = texts.flatMap((text) => text.calls);
  const ratios = calls.flatMap((call) =>
    call.outputTokensPerCharacter === null ? [] : [call.outputTokensPerCharacter],
  );
  const outputLimitCalls = calls.filter((call) => call.outcome === "output-limit").length;
  return {
    company: input.controls.model.company,
    modelId: input.controls.model.modelId,
    maxOutputTokens: input.controls.maxOutputTokens,
    windowCharacters: canonicalProfileExtractionWindowCharacters(input.controls.maxOutputTokens),
    texts,
    outputLimitCalls,
    maximumOutputTokensPerCharacter: ratios.length === 0 ? null : Math.max(...ratios),
    passed: outputLimitCalls === 0 && texts.every((text) => text.completed),
  };
}
