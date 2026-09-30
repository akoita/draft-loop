import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type {
  ProviderClientFactories,
  ProviderCredentialResolver,
  ProviderUserSessionRunners,
} from "./local-provider-adapter.js";
import { listModelProfileCatalog, listModelProfilePresets } from "./model-profile-catalog.js";
import type { RunProviderAuthModeConfiguration } from "./model-profile-selection.js";
import {
  buildModelSuggestionPreflightPlan,
  type ModelSuggestionPreflightPlan,
  modelSuggestionPreflightMaxOutputTokens,
  modelSuggestionPreflightTimeoutMs,
  runModelSuggestionPreflight,
} from "./model-suggestion-preflight.js";

const helpText = `DraftLoop model-suggestion preflight

Usage:
  pnpm test:model-suggestions:live [--plan]

With no option, sends one synthetic, content-free request to each registered
provider/model/role route. --plan prints the same bounded request and registry
plan without resolving credentials or creating provider adapters. Profile
controls are not tested. Results indicate availability under this bounded
check only; they do not establish account guarantees or CV quality.

Routes default to Anthropic API-key and OpenAI user-session. Override with
DRAFT_LOOP_ANTHROPIC_AUTH_MODE=api-key|user-session and
DRAFT_LOOP_OPENAI_AUTH_MODE=api-key|user-session. This command is local-only.
`;

export interface ModelSuggestionPreflightCommandDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly probeCliVersion?: (command: "claude" | "codex") => string | null;
  readonly resolveCredential?: ProviderCredentialResolver;
  readonly providerClientFactories?: ProviderClientFactories;
  readonly userSessionRunners?: ProviderUserSessionRunners;
  readonly writeStdout?: (value: string) => void;
  readonly writeStderr?: (value: string) => void;
}

const defaultModes: RunProviderAuthModeConfiguration = {
  anthropic: "api-key",
  openai: "user-session",
};

function enabled(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function authModesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RunProviderAuthModeConfiguration | null {
  const anthropic = environment.DRAFT_LOOP_ANTHROPIC_AUTH_MODE ?? defaultModes.anthropic;
  const openai = environment.DRAFT_LOOP_OPENAI_AUTH_MODE ?? defaultModes.openai;
  if (
    (anthropic !== "api-key" && anthropic !== "user-session") ||
    (openai !== "api-key" && openai !== "user-session")
  ) {
    return null;
  }
  return { anthropic, openai };
}

export function parseCliVersionOutput(value: string): string | null {
  const line = value.trim().split(/\r?\n/u, 1)[0]?.trim() ?? "";
  if (line.length > 128) return null;
  const match =
    /^(?:(?:claude(?: code)?|codex(?:-cli)?)\s+)?v?(\d+\.\d+(?:\.\d+){0,2})(?:\s+\((?:Claude Code|Codex CLI)\))?$/iu.exec(
      line,
    );
  return match?.[1] ?? null;
}

function probeCliVersion(command: "claude" | "codex"): string | null {
  const environment: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (process.platform === "win32") {
    if (process.env.SystemRoot !== undefined) environment.SystemRoot = process.env.SystemRoot;
    if (process.env.WINDIR !== undefined) environment.WINDIR = process.env.WINDIR;
  }
  try {
    const result = spawnSync(command, ["--version"], {
      env: environment,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 2_048,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== "string") {
      return null;
    }
    return parseCliVersionOutput(result.stdout);
  } catch {
    return null;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Run plan-only or the explicitly invoked bounded availability command. */
export async function runModelSuggestionPreflightCommand(
  args: readonly string[],
  dependencies: ModelSuggestionPreflightCommandDependencies = {},
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  const stdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  const stderr = dependencies.writeStderr ?? ((value) => process.stderr.write(value));

  if (args.length === 1 && args[0] === "--help") {
    stdout(helpText);
    return 0;
  }
  if (args.some((argument) => argument !== "--plan") || args.length > 1) {
    stderr("model-suggestion preflight: unsupported arguments. Use --help for usage.\n");
    return 2;
  }
  if (enabled(environment.CI) || enabled(environment.GITHUB_ACTIONS)) {
    stderr("model-suggestion preflight: local-only; CI/CD execution is refused.\n");
    return 2;
  }

  const authModes = authModesFromEnvironment(environment);
  if (authModes === null) {
    stderr("model-suggestion preflight: provider authentication mode is invalid.\n");
    return 2;
  }

  let plan: ModelSuggestionPreflightPlan;
  try {
    plan = buildModelSuggestionPreflightPlan(authModes);
  } catch {
    stderr("model-suggestion preflight: registered plan is invalid.\n");
    return 2;
  }

  const cliVersions = {
    claude:
      authModes.anthropic === "user-session"
        ? (dependencies.probeCliVersion ?? probeCliVersion)("claude")
        : null,
    codex:
      authModes.openai === "user-session"
        ? (dependencies.probeCliVersion ?? probeCliVersion)("codex")
        : null,
  };

  if (args.includes("--plan")) {
    stdout(
      json({
        mode: "plan",
        authModes,
        cliVersions,
        request: {
          systemPrompt:
            'This is a synthetic model-availability check. Return exactly {"ready":true} and nothing else. Do not use tools.',
          input: { check: "model-suggestion-preflight" },
          outputSchema: {
            type: "object",
            properties: { ready: { type: "boolean" } },
            required: ["ready"],
            additionalProperties: false,
          },
          maxOutputTokens: modelSuggestionPreflightMaxOutputTokens,
          timeoutMs: modelSuggestionPreflightTimeoutMs,
          profileControls: false,
        },
        profiles: listModelProfileCatalog().map(({ profile }) => ({
          id: profile.id,
          version: profile.version,
          provider: profile.provider,
          modelId: profile.modelId,
          roles: profile.roles,
        })),
        presets: listModelProfilePresets().map(({ id, author, critic }) => ({
          id,
          author,
          critic,
        })),
        rows: plan.rows,
      }),
    );
    return 0;
  }

  const result = await runModelSuggestionPreflight({
    authModes,
    resolveCredential:
      dependencies.resolveCredential ??
      (async (provider) =>
        provider === "anthropic" ? environment.ANTHROPIC_API_KEY : environment.OPENAI_API_KEY),
    ...(dependencies.providerClientFactories === undefined
      ? {}
      : { providerClientFactories: dependencies.providerClientFactories }),
    ...(dependencies.userSessionRunners === undefined
      ? {}
      : { userSessionRunners: dependencies.userSessionRunners }),
  });
  stdout(json({ ...result, cliVersions }));
  return result.passed ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runModelSuggestionPreflightCommand(process.argv.slice(2));
}
