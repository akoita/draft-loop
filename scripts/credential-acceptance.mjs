import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const phases = ["prepare", "verify"];

function canary(label) {
  return `draft-loop-${label}-${randomBytes(32).toString("base64url")}`;
}

async function requireFile(filename, label) {
  const details = await stat(filename);
  if (!details.isFile()) throw new Error(`${label} must be a file.`);
}

function launch(executable, phase, userData, evidencePath, secrets) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      executable,
      ["--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${userData}`],
      {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: secrets.environment,
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE: "1",
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_PHASE: phase,
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_EVIDENCE: evidencePath,
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_STORE: join(userData, "credentials.json"),
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_INITIAL: secrets.initial,
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_REPLACEMENT: secrets.replacement,
          DRAFT_LOOP_CREDENTIAL_ACCEPTANCE_ENVIRONMENT: secrets.environment,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", rejectLaunch);
    child.once("close", (code) => {
      if (code === 0) resolveLaunch(output);
      else rejectLaunch(new Error(`Credential acceptance ${phase} launch exited with ${code}.`));
    });
  });
}

function assertNoCanaries(value, secrets, label) {
  for (const secret of Object.values(secrets)) {
    if (value.includes(secret)) throw new Error(`Credential canary leaked into ${label}.`);
  }
}

export async function runCredentialAcceptance(executableInput, evidenceInput) {
  const executable = resolve(executableInput);
  const evidencePath = resolve(evidenceInput);
  await requireFile(executable, "Packaged executable");
  await mkdir(dirname(evidencePath), { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "draft-loop-credential-acceptance-"));
  const userData = join(temporaryRoot, "user-data");
  const secrets = {
    initial: canary("initial"),
    replacement: canary("replacement"),
    environment: canary("environment"),
  };

  try {
    let processOutput = "";
    for (const phase of phases) {
      processOutput += await launch(executable, phase, userData, evidencePath, secrets);
    }
    assertNoCanaries(processOutput, secrets, "process output");
    assertNoCanaries(await readFile(executable), secrets, "packaged executable");
    let credentialFile = "";
    try {
      credentialFile = await readFile(join(userData, "credentials.json"), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    assertNoCanaries(credentialFile, secrets, "credential storage");

    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    const sanitized = {
      ...evidence,
      negativeChecks: {
        processOutput: "no-canary",
        credentialStorage: "no-plaintext-canary",
        packagedExecutable: "no-canary",
      },
    };
    const serialized = `${JSON.stringify(sanitized, null, 2)}\n`;
    assertNoCanaries(serialized, secrets, "evidence");
    await writeFile(evidencePath, serialized, { encoding: "utf8", mode: 0o600 });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
  }
}

const argumentsList = process.argv.slice(2);
const inputs = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;

if (inputs.length !== 2) {
  process.stderr.write(
    "Usage: node scripts/credential-acceptance.mjs <packaged-executable> <evidence.json>",
  );
  process.stderr.write("\n");
  process.exitCode = 2;
} else {
  try {
    await runCredentialAcceptance(inputs[0], inputs[1]);
    process.stdout.write(
      `credential acceptance passed; sanitized evidence: ${resolve(inputs[1])}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Credential acceptance failed."}\n`,
    );
    process.exitCode = 1;
  }
}
