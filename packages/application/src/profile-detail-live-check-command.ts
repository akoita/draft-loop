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
  type ProfileDetailLiveCheckResult,
  runProfileDetailLiveCheck,
} from "./profile-detail-live-check.js";

const helpText = `DraftLoop profile employment-detail live check

Usage:
  pnpm test:profile-details:live [<company>/<modelId> ...]

Extracts a canonical profile once from short, made-up career notes that state
a final salary and a reason for leaving, with each route's real extraction
prompt, and fails unless both come back as employment-detail facts (#2722).
It prints the fact counts and the call's tokens. No candidate material is read
or sent. Routes default to anthropic/claude-haiku-5-5.

Credentials come from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY,
MISTRAL_API_KEY, GEMINI_API_KEY, DEEPINFRA_API_KEY). This command is
local-only.
`;

export interface ProfileDetailLiveCheckCommandDependencies {
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

/** Run the explicitly invoked, synthetic-notes employment-detail check. */
export async function runProfileDetailLiveCheckCommand(
  args: readonly string[],
  dependencies: ProfileDetailLiveCheckCommandDependencies = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  const stdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  const stderr = dependencies.writeStderr ?? ((value) => process.stderr.write(value));

  if (args.includes("--help")) {
    stdout(helpText);
    return 0;
  }
  if (enabled(environment.CI) || enabled(environment.GITHUB_ACTIONS)) {
    stderr("profile detail live check: local-only; CI/CD execution is refused.\n");
    return 2;
  }
  const routes = (args.length === 0 ? ["anthropic/claude-haiku-5-5"] : args).map(parseRoute);
  if (routes.some((route) => route === null)) {
    stderr("profile detail live check: routes must be <company>/<modelId>. Use --help.\n");
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
    stderr("profile detail live check: provider authentication mode is invalid.\n");
    return 2;
  }

  const results: ProfileDetailLiveCheckResult[] = [];
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
    const result = await runProfileDetailLiveCheck({
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
      `${route.company}/${route.modelId}: ${result.passed ? "passed" : "failed"}, ${result.employmentDetailFacts} employment-detail facts, salary ${result.salaryKept ? "kept" : "dropped"}, reason for leaving ${result.reasonForLeavingKept ? "kept" : "dropped"}\n`,
    );
  }
  stdout(`${JSON.stringify({ results }, null, 2)}\n`);
  return results.every((result) => result.passed) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProfileDetailLiveCheckCommand(process.argv.slice(2));
}
