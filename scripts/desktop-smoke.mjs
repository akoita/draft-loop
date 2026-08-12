import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const SMOKE_PHASES = Object.freeze(["prepare", "resume"]);

const USAGE = `Usage: node scripts/desktop-smoke.mjs <packaged-app-path> [--keep-workspace|--keep]

Launches the packaged DraftLoop Electron app for the prepare and resume smoke phases.
`;

const ELECTRON_SMOKE_ARGUMENTS = Object.freeze(["--headless", "--disable-gpu", "--no-sandbox"]);

export class DesktopSmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopSmokeError";
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parseArguments(argumentsList) {
  const cliArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  if (cliArguments.length === 0) {
    throw new DesktopSmokeError(`packaged app path is required\n\n${USAGE}`);
  }
  if (cliArguments[0] === "--help" || cliArguments[0] === "-h") {
    return { help: true };
  }

  const packagedAppPath = cliArguments[0];
  let keepWorkspace = false;
  for (const argument of cliArguments.slice(1)) {
    if (argument === "--keep-workspace" || argument === "--keep") {
      keepWorkspace = true;
      continue;
    }
    throw new DesktopSmokeError(`unknown argument: ${argument}\n\n${USAGE}`);
  }

  return {
    help: false,
    keepWorkspace,
    packagedAppPath: resolve(process.cwd(), packagedAppPath),
  };
}

async function assertPackagedApp(packagedAppPath) {
  let details;
  try {
    details = await stat(packagedAppPath);
  } catch (error) {
    throw new DesktopSmokeError(
      `packaged app path cannot be accessed: ${packagedAppPath}\n${describeError(error)}`,
    );
  }
  if (!details.isFile()) {
    throw new DesktopSmokeError(`packaged app path must be an executable file: ${packagedAppPath}`);
  }
}

function spawnSmokePhase(packagedAppPath, phase, workspace) {
  return new Promise((resolvePhase, rejectPhase) => {
    const child = spawn(packagedAppPath, ELECTRON_SMOKE_ARGUMENTS, {
      env: {
        ...process.env,
        DRAFT_LOOP_SMOKE: "1",
        DRAFT_LOOP_SMOKE_PHASE: phase,
        DRAFT_LOOP_SMOKE_WORKSPACE: workspace,
      },
      stdio: "inherit",
      windowsHide: true,
    });
    let settled = false;

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectPhase(
        new DesktopSmokeError(
          `smoke phase "${phase}" could not start ${packagedAppPath}: ${describeError(error)}\n` +
            `workspace: ${workspace}`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolvePhase();
        return;
      }

      const status = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      rejectPhase(
        new DesktopSmokeError(
          `smoke phase "${phase}" failed: ${packagedAppPath} exited with ${status}\n` +
            `workspace: ${workspace}`,
        ),
      );
    });
  });
}

export async function runSmoke(
  { packagedAppPath, keepWorkspace = false },
  { stdout = process.stdout } = {},
) {
  await assertPackagedApp(packagedAppPath);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "draft-loop-smoke-"));
  const workspace = join(temporaryRoot, "workspace");
  let failure;

  try {
    stdout.write(`desktop smoke: workspace ${workspace}\n`);
    for (const phase of SMOKE_PHASES) {
      stdout.write(`desktop smoke: launching phase "${phase}"\n`);
      await spawnSmokePhase(packagedAppPath, phase, workspace);
    }
  } catch (error) {
    failure = error;
  }

  if (keepWorkspace) {
    stdout.write(`desktop smoke: keeping workspace ${workspace}\n`);
  } else {
    try {
      await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      const cleanupFailure = new DesktopSmokeError(
        `could not clean temporary smoke workspace ${workspace}: ${describeError(error)}`,
      );
      failure =
        failure === undefined
          ? cleanupFailure
          : new DesktopSmokeError(`${describeError(failure)}\n${cleanupFailure.message}`);
    }
  }

  if (failure !== undefined) throw failure;
  stdout.write("desktop smoke: passed\n");
  return workspace;
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

    await runSmoke(options, { stdout });
    return 0;
  } catch (error) {
    stderr.write(`desktop smoke: ${describeError(error)}\n`);
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
