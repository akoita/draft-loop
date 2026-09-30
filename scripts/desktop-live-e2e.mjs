import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

const LIVE_E2E_TIMEOUT_MS = 240_000;
const USAGE = `Usage: pnpm test:e2e:live [--keep] [<packaged-executable> [<evidence.json>]]

Launches the desktop live-provider E2E with synthetic example.test material.
Without a packaged executable the gate runs the desktop dev app and requires
API keys by default. Set DRAFT_LOOP_PROVIDER_AUTH_MODE=user-session explicitly
to use authenticated Claude and Codex user sessions, or set the provider-specific
DRAFT_LOOP_ANTHROPIC_AUTH_MODE and DRAFT_LOOP_OPENAI_AUTH_MODE overrides.
With a packaged executable the gate runs headless and requires ANTHROPIC_API_KEY
and OPENAI_API_KEY in the environment.

User-session mode uses your provider subscriptions and remains subject to their
allowances. API-key mode bills real provider usage. The gate runs a verified cross-company
pair by default; override either side with DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL or
DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL.
`;
const PACKAGED_CREDENTIAL_VARIABLES = Object.freeze(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
const AUTHOR_MODEL_VARIABLE = "DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL";
const CRITIC_MODEL_VARIABLE = "DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL";
const AUTH_MODE_VARIABLE = "DRAFT_LOOP_PROVIDER_AUTH_MODE";
const ANTHROPIC_AUTH_MODE_VARIABLE = "DRAFT_LOOP_ANTHROPIC_AUTH_MODE";
const OPENAI_AUTH_MODE_VARIABLE = "DRAFT_LOOP_OPENAI_AUTH_MODE";
const PRESERVE_WORKSPACE_ON_FAILURE_VARIABLE = "DRAFT_LOOP_LIVE_E2E_PRESERVE_WORKSPACE_ON_FAILURE";
/**
 * The gate exercises the real provider path, so it should run the cheapest
 * models that still do so rather than the workspace defaults. Anthropic and
 * OpenAI remain the cross-company pair, so provider-diversity is unaffected.
 */
const DEFAULT_AUTHOR_MODEL = "claude-haiku-4-5";
const DEFAULT_CRITIC_MODEL = "gpt-5.6-luna";
const PACKAGED_LAUNCH_ARGUMENTS = Object.freeze(["--headless", "--disable-gpu", "--no-sandbox"]);
const jobContent = `# Platform Engineer — Willowmere Developer Tools

- Implement TypeScript command-line tooling on Node.js to validate \`package.json\` manifests and explain missing project scripts.
- Build a React page that displays the validation report.
- Add automated unit tests for manifest validation and command exit statuses.
- Create accessible forms with associated labels and a predictable keyboard focus order.
- Write concise Markdown setup and troubleshooting guides.
`;
const candidateContent = `# Sela Nareth

**Contact**: \`sela.nareth@candidate.test\`

## Summary

Platform engineer focused on JavaScript and TypeScript developer tooling. Recent work includes local validation tools, an internal report view, automated tests, keyboard accessibility, and user documentation.

## Experience

### Morrowbeam Build Cooperative — Platform Engineer — April 2021 to present

Worked in a four-engineer platform group. Built a TypeScript command-line tool on Node.js that reads \`package.json\` manifests and reports missing project scripts before release. Product engineers ran it locally; it did not change CI policy or deploy services.

Added Vitest unit tests for manifest validation and command exit statuses. Built a React page that displays the validation report, with associated form labels and a predictable keyboard focus order; checked the page in a keyboard-only walkthrough, not a formal accessibility audit. Wrote Markdown setup and troubleshooting guides for the tool.

### Saltmere Integration Studio — Software Engineer — September 2018 to March 2021

Created a TypeScript utility on Node.js to normalize local JSON fixtures used in integration tests. Added automated tests for malformed fixture data and wrote a short local setup guide. This utility was used by the studio's integration team and was not a customer-facing service.

## Education

BSc in Software Engineering, Keelpoint University, 2018.

## Skills

TypeScript, Node.js, React, Vitest, JSON, command-line tooling, keyboard navigation, HTML forms, and Markdown documentation.

## Languages

English — fluent; Portuguese — conversational.
`;

class DesktopLiveE2EError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopLiveE2EError";
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function stopChildProcess(child) {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to terminating the direct child when a process group is unavailable.
    }
  }
  child.kill();
}

export function parseArguments(argumentsList) {
  const cliArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  let keep = false;
  const positionals = [];
  for (const argument of cliArguments) {
    if (argument === "--keep" || argument === "--keep-workspace") {
      keep = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      return { help: true, keep: false, executable: undefined, evidence: undefined };
    }
    if (argument.startsWith("-")) {
      throw new DesktopLiveE2EError(`unknown argument: ${argument}\n\n${USAGE}`);
    }
    positionals.push(argument);
  }
  if (positionals.length > 2) {
    throw new DesktopLiveE2EError(`unexpected argument: ${positionals[2]}\n\n${USAGE}`);
  }
  return { help: false, keep, executable: positionals[0], evidence: positionals[1] };
}

/**
 * Resolves the author and critic models the gate will run. An empty or
 * whitespace-only override falls back to the default rather than propagating an
 * empty model id to the desktop host.
 */
export function resolveGateModels(environment = process.env) {
  const author = environment[AUTHOR_MODEL_VARIABLE]?.trim();
  const critic = environment[CRITIC_MODEL_VARIABLE]?.trim();
  return {
    author: author === undefined || author === "" ? DEFAULT_AUTHOR_MODEL : author,
    critic: critic === undefined || critic === "" ? DEFAULT_CRITIC_MODEL : critic,
  };
}

export function resolveGateAuthMode(environment = process.env) {
  const value = environment[AUTH_MODE_VARIABLE];
  if (value === undefined) return "api-key";
  if (value === "api-key" || value === "user-session") return value;
  throw new DesktopLiveE2EError(`unsupported ${AUTH_MODE_VARIABLE}: ${value}`);
}

export function resolveGateAuthModes(environment = process.env) {
  const fallback = resolveGateAuthMode(environment);
  const resolveOverride = (variable) => {
    const value = environment[variable];
    if (value === undefined) return fallback;
    if (value === "api-key" || value === "user-session") return value;
    throw new DesktopLiveE2EError(`unsupported ${variable}: ${value}`);
  };
  return {
    anthropic: resolveOverride(ANTHROPIC_AUTH_MODE_VARIABLE),
    openai: resolveOverride(OPENAI_AUTH_MODE_VARIABLE),
  };
}

function assertPackagedCredentials() {
  for (const variable of PACKAGED_CREDENTIAL_VARIABLES) {
    const value = process.env[variable];
    if (value === undefined || value.trim() === "") {
      throw new DesktopLiveE2EError(
        `packaged live E2E requires ${variable} in the environment; it is missing or empty.`,
      );
    }
  }
}

async function requirePackagedExecutable(executable) {
  let details;
  try {
    details = await stat(executable);
  } catch {
    throw new DesktopLiveE2EError("packaged live E2E executable could not be read.");
  }
  if (!details.isFile()) {
    throw new DesktopLiveE2EError("packaged live E2E executable must be a file.");
  }
}

async function writeSyntheticInputs(paths) {
  await writeFile(paths.job, jobContent, { encoding: "utf8", mode: 0o600 });
  await writeFile(paths.candidate, candidateContent, { encoding: "utf8", mode: 0o600 });
  await chmod(paths.job, 0o600);
  await chmod(paths.candidate, 0o600);
}

export function launchLiveE2E(
  paths,
  executable,
  models = resolveGateModels(),
  authModes = resolveGateAuthModes(process.env),
  spawnProcess = spawn,
) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const packaged = executable !== undefined;
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const displayEnvironment =
      !packaged &&
      process.platform === "linux" &&
      process.env.DISPLAY === undefined &&
      existsSync("/tmp/.X11-unix/X0")
        ? { DISPLAY: ":0" }
        : {};
    const command = packaged ? executable : pnpm;
    const commandArguments = packaged
      ? [...PACKAGED_LAUNCH_ARGUMENTS, `--user-data-dir=${paths.userData}`]
      : ["--filter", "@draft-loop/desktop", "start", "--", `--user-data-dir=${paths.userData}`];
    const child = spawnProcess(command, commandArguments, {
      cwd: resolve(process.cwd()),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== PRESERVE_WORKSPACE_ON_FAILURE_VARIABLE,
          ),
        ),
        ...displayEnvironment,
        DRAFT_LOOP_LIVE_E2E: "1",
        DRAFT_LOOP_LIVE_E2E_WORKSPACE: paths.workspace,
        DRAFT_LOOP_LIVE_E2E_JOB: paths.job,
        DRAFT_LOOP_LIVE_E2E_CANDIDATE: paths.candidate,
        DRAFT_LOOP_LIVE_E2E_EVIDENCE: paths.report,
        [AUTHOR_MODEL_VARIABLE]: models.author,
        [CRITIC_MODEL_VARIABLE]: models.critic,
        [ANTHROPIC_AUTH_MODE_VARIABLE]: authModes.anthropic,
        [OPENAI_AUTH_MODE_VARIABLE]: authModes.openai,
      },
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let settled = false;
    let safeFailure = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u)) {
        if (line.includes("Live provider E2E")) {
          safeFailure = line.replaceAll(paths.root, "<temporary-workspace>").slice(-1000);
        }
      }
    });
    const timeout = scheduleTimeout(() => {
      if (settled) return;
      settled = true;
      stopChildProcess(child);
      rejectLaunch(new DesktopLiveE2EError("desktop live E2E exceeded its bounded timeout."));
    }, LIVE_E2E_TIMEOUT_MS);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cancelTimeout(timeout);
      rejectLaunch(
        new DesktopLiveE2EError(`desktop live E2E could not start: ${describeError(error)}`),
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cancelTimeout(timeout);
      if (code === 0 && safeFailure === "") {
        resolveLaunch();
        return;
      }
      const status = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      rejectLaunch(
        new DesktopLiveE2EError(
          `desktop live E2E failed with ${status}${safeFailure === "" ? "." : `: ${safeFailure}`}`,
        ),
      );
    });
  });
}

function assertSanitizedReport(report, paths) {
  if (report?.stage !== "desktop-live-e2e" || report?.providerMode !== "live") {
    throw new DesktopLiveE2EError("desktop live E2E produced an invalid evidence report.");
  }
  const serialized = JSON.stringify(report);
  if (
    serialized.includes(jobContent) ||
    serialized.includes(candidateContent) ||
    serialized.includes(paths.root)
  ) {
    throw new DesktopLiveE2EError("desktop live E2E evidence report was not sanitized.");
  }
}

export async function runLiveE2E(
  { keep = false, executable, evidence } = {},
  {
    stdout = process.stdout,
    launch = launchLiveE2E,
    preserveWorkspaceOnFailure = process.env[PRESERVE_WORKSPACE_ON_FAILURE_VARIABLE] === "1",
  } = {},
) {
  const packagedExecutable = executable === undefined ? undefined : resolve(executable);
  const evidencePath = evidence === undefined ? undefined : resolve(evidence);
  const authModes = resolveGateAuthModes(process.env);
  if (packagedExecutable !== undefined) {
    if (Object.values(authModes).includes("user-session")) {
      throw new DesktopLiveE2EError(
        "packaged live E2E does not support user-session mode; use api-key mode.",
      );
    }
    assertPackagedCredentials();
    await requirePackagedExecutable(packagedExecutable);
  }
  if (evidencePath !== undefined) {
    await mkdir(dirname(evidencePath), { recursive: true });
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "draft-loop-live-e2e-"));
  const paths = {
    root: temporaryRoot,
    userData: join(temporaryRoot, "user-data"),
    workspace: join(temporaryRoot, "workspace"),
    job: join(temporaryRoot, "job.md"),
    candidate: join(temporaryRoot, "candidate.md"),
    report: evidencePath ?? join(temporaryRoot, "report.json"),
  };
  const models = resolveGateModels();
  let failure;
  let retainedAfterFailure = false;

  try {
    await writeSyntheticInputs(paths);
    stdout.write(
      `Live-provider gate: Anthropic ${authModes.anthropic}, OpenAI ${authModes.openai}; author ${models.author}, critic ${models.critic}.\n`,
    );
    await launch(paths, packagedExecutable, models, authModes);
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assertSanitizedReport(report, paths);
    const reportDetails = await stat(paths.report);
    if (!reportDetails.isFile() || (reportDetails.mode & 0o777) !== 0o600) {
      throw new DesktopLiveE2EError("desktop live E2E evidence report permissions are unsafe.");
    }
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    failure = error;
    retainedAfterFailure = preserveWorkspaceOnFailure;
  } finally {
    if (!keep && !retainedAfterFailure) {
      try {
        await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        failure =
          failure === undefined
            ? new DesktopLiveE2EError("desktop live E2E temporary files could not be cleaned up.")
            : failure;
      }
    }
  }

  if (retainedAfterFailure) {
    stdout.write(`Synthetic live E2E workspace retained after failure: ${temporaryRoot}\n`);
  }
  if (failure !== undefined) throw failure;
}

export async function main(
  argumentsList = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    const options = parseArguments(argumentsList);
    if (options.help) {
      stdout.write(USAGE);
      return 0;
    }
    await runLiveE2E(options, { stdout });
    return 0;
  } catch (error) {
    stderr.write(`desktop live E2E: ${describeError(error)}\n`);
    return 1;
  }
}

function isMainModule() {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && pathToFileURL(resolve(entryPoint)).href === import.meta.url;
}

if (isMainModule()) {
  process.exitCode = await main();
}
