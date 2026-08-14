import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const phases = ["prepare", "resume"];
const jobUrl = "https://jobs.example.test/roles/typescript-systems-engineer";
const candidateContent =
  "Sanitized candidate profile\n\n" +
  "Target role: TypeScript systems engineer\n" +
  "Experience: Built local-first TypeScript tools with automated tests and clear documentation.\n" +
  "Skills: TypeScript, React, Node.js, testing, accessibility, and technical writing.\n";

async function requireFile(filename, label) {
  const details = await stat(filename);
  if (!details.isFile()) throw new Error(`${label} must be a file.`);
}

function launch(executable, phase, paths, artifactChecksum) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      executable,
      ["--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${paths.userData}`],
      {
        env: {
          ...process.env,
          DRAFT_LOOP_ACCEPTANCE: "1",
          DRAFT_LOOP_ACCEPTANCE_PHASE: phase,
          DRAFT_LOOP_ACCEPTANCE_WORKSPACE: paths.workspace,
          DRAFT_LOOP_ACCEPTANCE_CANDIDATE: paths.candidate,
          DRAFT_LOOP_ACCEPTANCE_EVIDENCE: paths.evidence,
          DRAFT_LOOP_ACCEPTANCE_ARTIFACT_SHA256: artifactChecksum,
          DRAFT_LOOP_ACCEPTANCE_JOB_URL: jobUrl,
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
      else rejectLaunch(new Error(`Installed-app acceptance ${phase} launch exited with ${code}.`));
    });
  });
}

export async function runAcceptance(executableInput, evidenceInput) {
  const executable = resolve(executableInput);
  const evidence = resolve(evidenceInput);
  await requireFile(executable, "Packaged executable");
  await mkdir(dirname(evidence), { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "draft-loop-installed-acceptance-"));
  const paths = {
    userData: join(temporaryRoot, "user-data"),
    workspace: join(temporaryRoot, "workspace"),
    candidate: join(temporaryRoot, "candidate.md"),
    evidence,
  };
  await writeFile(paths.candidate, candidateContent, { encoding: "utf8", mode: 0o600 });
  const artifactChecksum = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");

  try {
    let output = "";
    for (const phase of phases) {
      output += await launch(executable, phase, paths, artifactChecksum);
    }
    if (output.includes(candidateContent) || output.includes(jobUrl)) {
      throw new Error("Installed-app acceptance leaked sanitized input into process output.");
    }

    const report = JSON.parse(await readFile(evidence, "utf8"));
    if (report.artifactChecksum !== artifactChecksum) {
      throw new Error("Installed-app acceptance reported the wrong artifact checksum.");
    }
    const requiredChecks = [
      "installLaunch",
      "workspaceCreation",
      "candidateImport",
      "approvedJobUrl",
      "provenance",
      "providerPreflight",
      "authorCriticRun",
      "revision",
      "restartResume",
      "approval",
      "exportMarkdown",
      "exportDocx",
      "exportPdf",
      "durableHistory",
    ];
    for (const check of requiredChecks) {
      if (report.checks?.[check] !== true) {
        throw new Error(`Installed-app acceptance did not pass check ${check}.`);
      }
    }
    const sanitized = {
      ...report,
      runnerChecks: {
        processOutput: "no-sanitized-input",
        artifactChecksum: "matches-packaged-executable",
      },
    };
    const serialized = `${JSON.stringify(sanitized, null, 2)}\n`;
    if (serialized.includes(candidateContent) || serialized.includes(jobUrl)) {
      throw new Error("Installed-app acceptance evidence contains input content.");
    }
    await writeFile(evidence, serialized, { encoding: "utf8", mode: 0o600 });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
  }
}

const inputs = process.argv.slice(2);
const normalizedInputs = inputs[0] === "--" ? inputs.slice(1) : inputs;
if (normalizedInputs.length !== 2) {
  process.stderr.write(
    "Usage: node scripts/desktop-acceptance.mjs <packaged-executable> <evidence.json>\n",
  );
  process.exitCode = 2;
} else {
  try {
    await runAcceptance(normalizedInputs[0], normalizedInputs[1]);
    process.stdout.write(`installed-app acceptance passed: ${resolve(normalizedInputs[1])}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Installed-app acceptance failed."}\n`,
    );
    process.exitCode = 1;
  }
}
