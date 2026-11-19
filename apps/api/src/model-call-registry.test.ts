import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { modelCallPaths } from "./model-call-registry.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const scanned = ["apps/api/src", "apps/worker/src"];

/**
 * Names from `@draft-loop/model-gateway` that never call a model: credentials, prices, locations
 * and types. Any other name imported from it builds a model client or route.
 */
const nonCallingGatewayNames = new Set([
  "assertLocationPriceFactor",
  "claudeSearchTokenPricing",
  "contentScreeningModelId",
  "createFileCredentialResolver",
  "createSecretManagerCredentialResolver",
  "CredentialResolver",
  "DecisionScreeningShadow",
  "defaultEndOfTurnPause",
  "defaultSecretsDirectory",
  "EndOfTurnPause",
  "googleChirp3HdPricing",
  "googleChirp3Pricing",
  "HostedAnthropicRouteOptions",
  "HostedContentScreenerOptions",
  "isVertexClaudeModel",
  "ModelScreeningUsage",
  "OpenAiEndpoint",
  "SecretVersionReader",
  "vertexEuLocation",
]);

/**
 * Files that reach a model but start no member's path: they build the clients the registered
 * paths use, or are operator checks with their own fixed caps.
 */
const wiring: Record<string, string> = {
  "apps/worker/src/model-routes.ts": "builds the worker's model routes for every queued path",
  "apps/worker/src/route-config.ts": "builds the worker's provider clients",
  "apps/worker/src/config.ts": "reads the worker's model settings",
  "apps/worker/src/main.ts": "hands the routes to the job handlers",
  "apps/worker/src/local-models-config.ts":
    "reads the self-hosted local model endpoints, never metered",
  "apps/worker/src/gateway-live-check.ts": "operator's one-call gateway check",
  "apps/worker/src/support-golden-set-check.ts": "operator's golden-set check, capped in dollars",
};

/** A queued model job started from an API route: a run, an extraction, a review or research. */
const queuesModelJob =
  /(?<![.\w])enqueueRun\(|\b(?:reviews|runs|derivations|briefExtractions|extractions)\.queue\(/u;
const importsWorkerRoutes = /from "\.\/(?:model-routes|route-config)\.js"/u;
const importsProviders = /from "@draft-loop\/providers"/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !/\.test\.ts$|test-support/u.test(entry.name)
      ? [path]
      : [];
  });
}

function gatewayNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@draft-loop\/model-gateway"/gu,
  )) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.replace(/\btype\b/u, "").trim();
      if (name !== "") names.push(name);
    }
  }
  return names;
}

/** The scanned files that reach the model gateway, each with why the test thinks so. */
function gatewayReachingFiles(): Map<string, string> {
  const reaching = new Map<string, string>();
  for (const file of scanned.flatMap(sourceFiles)) {
    const text = readFileSync(join(repositoryRoot, file), "utf8");
    const calling = gatewayNames(text).filter((name) => !nonCallingGatewayNames.has(name));
    const path = relative(repositoryRoot, join(repositoryRoot, file)).replaceAll("\\", "/");
    if (calling.length > 0) reaching.set(path, `imports ${calling.join(", ")}`);
    else if (queuesModelJob.test(text)) reaching.set(path, "queues a model job");
    else if (importsWorkerRoutes.test(text)) reaching.set(path, "uses the worker's model routes");
    else if (importsProviders.test(text)) reaching.set(path, "imports a provider adapter");
  }
  return reaching;
}

describe("model call registry", () => {
  it("gives every path a limit, a cost cap and a kill switch", () => {
    for (const path of modelCallPaths) {
      expect(path.limit.trim(), path.id).not.toBe("");
      expect(path.costCap.trim(), path.id).not.toBe("");
      expect(path.killSwitch.trim(), path.id).not.toBe("");
    }
    expect(new Set(modelCallPaths.map((path) => path.id)).size).toBe(modelCallPaths.length);
  });

  it("names only files that exist", () => {
    for (const file of modelCallPaths.flatMap((path) => path.reaches)) {
      expect(existsSync(join(repositoryRoot, file)), file).toBe(true);
    }
  });

  it("registers every file that reaches the model gateway", () => {
    const registered = new Set(modelCallPaths.flatMap((path) => path.reaches));
    const unregistered = [...gatewayReachingFiles()]
      .filter(([file]) => !registered.has(file) && wiring[file] === undefined)
      .map(([file, why]) => `${file} (${why})`);
    expect(unregistered).toEqual([]);
  });

  it("finds the paths it should, so the scan itself works", () => {
    const reaching = gatewayReachingFiles();
    for (const file of [
      "apps/api/src/support-routes.ts",
      "apps/api/src/application-routes.ts",
      "apps/worker/src/research-search-wiring.ts",
    ]) {
      expect(reaching.has(file), file).toBe(true);
    }
  });

  it("names every route a registered path starts in the API's source", () => {
    const source = sourceFiles("apps/api/src")
      .map((file) => readFileSync(join(repositoryRoot, file), "utf8"))
      .join("\n");
    for (const route of modelCallPaths.flatMap((path) => path.routes)) {
      const tail = route.url.split("/").slice(-2).join("/");
      expect(source.includes(tail), route.url).toBe(true);
    }
  });
});
