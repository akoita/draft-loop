import process from "node:process";
import { pathToFileURL } from "node:url";

import { canonicalProfileExtractionModel } from "./candidate-profile-extraction-identity.js";
import type { CanonicalProfileExtractionExecutor } from "./canonical-profile-extraction-fallback.js";
import { canonicalProfileRequest } from "./canonical-profile-provider-request.js";
import {
  environmentCredentialResolver,
  providerDataPolicy,
  resolveProviderAuthModes,
} from "./glm-provider-routing.js";
import { createProviderAdapter } from "./local-provider-adapter.js";
import {
  type ProfileWindowLiveCheckResult,
  runProfileWindowLiveCheck,
} from "./profile-window-live-check.js";

const helpText = `DraftLoop profile window live check

Usage:
  pnpm test:profile-windows:live [<company>/<modelId> ...]

Extracts a canonical profile from two made-up career texts (dense bullets and
prose, about 70,000 characters each) through the planned-window path, with each
route's real extraction prompt and output budget. It prints, per provider call,
the source size, duration, outcome and output tokens, and fails when any call
hits the output limit at the planned window size. No candidate material is read
or sent. Routes default to mistral/mistral-large-4.

Credentials come from the environment (MISTRAL_API_KEY, ANTHROPIC_API_KEY,
OPENAI_API_KEY, GEMINI_API_KEY, DEEPINFRA_API_KEY). Set
DRAFT_LOOP_ANTHROPIC_AUTH_MODE or DRAFT_LOOP_OPENAI_AUTH_MODE to user-session
to use a signed-in CLI instead. This command is local-only.
`;

export interface ProfileWindowLiveCheckCommandDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly createExecutor?: (route: {
    readonly company: string;
    readonly modelId: string;
  }) => Promise<CanonicalProfileExtractionExecutor>;
  readonly writeStdout?: (value: string) => void;
  readonly writeStderr?: (value: string) => void;
}

function enabled(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function parseRoute(value: string): { company: string; modelId: string } | null {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { company: value.slice(0, separator), modelId: value.slice(separator + 1) };
}

/** Run the explicitly invoked, synthetic-text profile window check. */
export async function runProfileWindowLiveCheckCommand(
  args: readonly string[],
  dependencies: ProfileWindowLiveCheckCommandDependencies = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  const stdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  const stderr = dependencies.writeStderr ?? ((value) => process.stderr.write(value));

  if (args.includes("--help")) {
    stdout(helpText);
    return 0;
  }
  if (enabled(environment.CI) || enabled(environment.GITHUB_ACTIONS)) {
    stderr("profile window live check: local-only; CI/CD execution is refused.\n");
    return 2;
  }
  const routes = (args.length === 0 ? ["mistral/mistral-large-4"] : args).map(parseRoute);
  if (routes.some((route) => route === null)) {
    stderr("profile window live check: routes must be <company>/<modelId>. Use --help.\n");
    return 2;
  }

  let authModes: ReturnType<typeof resolveProviderAuthModes>;
  try {
    authModes = resolveProviderAuthModes(
      undefined,
      environment.DRAFT_LOOP_ANTHROPIC_AUTH_MODE,
      environment.DRAFT_LOOP_OPENAI_AUTH_MODE,
    );
  } catch {
    stderr("profile window live check: provider authentication mode is invalid.\n");
    return 2;
  }

  const results: ProfileWindowLiveCheckResult[] = [];
  for (const route of routes) {
    if (route === null) continue;
    const model = canonicalProfileExtractionModel(route.company, route.modelId);
    const contract = canonicalProfileRequest(model, authModes.anthropic);
    const executor =
      (await dependencies.createExecutor?.(route)) ??
      (await createProviderAdapter(
        {},
        model,
        true,
        environmentCredentialResolver,
        undefined,
        authModes,
      ));
    const result = await runProfileWindowLiveCheck({
      executor,
      controls: {
        model,
        systemPrompt: contract.systemPrompt,
        maxOutputTokens: contract.maxOutputTokens,
        dataPolicy: providerDataPolicy(route.company, true, authModes),
      },
    });
    results.push(result);
    stderr(
      `${route.company}/${route.modelId}: ${result.passed ? "passed" : "failed"}, ${result.outputLimitCalls} output-limit calls, max ${result.maximumOutputTokensPerCharacter ?? "n/a"} output tokens per character\n`,
    );
  }
  stdout(`${JSON.stringify({ results }, null, 2)}\n`);
  return results.every((result) => result.passed) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProfileWindowLiveCheckCommand(process.argv.slice(2));
}
