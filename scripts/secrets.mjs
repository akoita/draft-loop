#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import console from "node:console";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

export const SECRET_PATTERNS = [
  {
    name: "Anthropic API Key",
    regex: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{40,}\b/gu,
  },
  {
    name: "OpenAI Project Key",
    regex: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/gu,
  },
  {
    name: "OpenAI Legacy Key",
    regex: /\bsk-[A-Za-z0-9]{48,}\b/gu,
  },
  {
    name: "GitHub Personal Access Token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/gu,
  },
  {
    name: "GitHub Fine-Grained Token",
    regex: /\bgithub_pat_[A-Za-z0-9_]{82}\b/gu,
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/gu,
  },
  {
    name: "Private Key Header",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
];

export function getTrackedFiles(root = rootDir) {
  let output;
  try {
    output = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`Git tracked-file discovery failed for ${root}`, { cause: error });
  }
  const files = output
    .split("\0")
    .filter((file) => file.length > 0)
    .map((file) => join(root, file));
  if (files.length === 0) {
    throw new Error(`Git tracked-file discovery returned no files for ${root}`);
  }
  return files;
}

export function scanFileForSecretsDetailed(filePath, patterns = SECRET_PATTERNS) {
  if (!existsSync(filePath)) {
    return {
      findings: [],
      diagnostic: { file: filePath, reason: "Tracked file is missing." },
    };
  }
  let stat;
  try {
    stat = statSync(filePath);
  } catch (error) {
    return {
      findings: [],
      diagnostic: {
        file: filePath,
        reason: `Tracked file metadata is unreadable: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }
  if (!stat.isFile()) {
    return {
      findings: [],
      diagnostic: { file: filePath, reason: "Tracked path is not a regular file." },
    };
  }
  if (stat.size > 2 * 1024 * 1024) {
    return {
      findings: [],
      diagnostic: {
        file: filePath,
        reason: `Tracked file was skipped because it exceeds the 2 MiB scan limit (${stat.size} bytes).`,
      },
    };
  }

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      findings: [],
      diagnostic: {
        file: filePath,
        reason: `Tracked file is unreadable: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    };
  }

  const findings = [];
  const lines = content.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    // Allow synthetic test fixtures that explicitly mark placeholder secrets
    if (
      line.includes("mock-key") ||
      line.includes("test-token") ||
      line.includes("placeholder-secret")
    ) {
      continue;
    }

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({
          file: filePath,
          line: lineIndex + 1,
          rule: pattern.name,
          preview: line.slice(0, 80),
        });
      }
    }
  }

  return { findings };
}

export function scanFileForSecrets(filePath, patterns = SECRET_PATTERNS) {
  return scanFileForSecretsDetailed(filePath, patterns).findings;
}

export function scanRepositoryForSecrets(root = rootDir, patterns = SECRET_PATTERNS) {
  const findings = [];
  const diagnostics = [];
  let files;

  try {
    files = getTrackedFiles(root);
  } catch (error) {
    diagnostics.push({
      file: root,
      reason: error instanceof Error ? error.message : "Git tracked-file discovery failed.",
    });
    return { scannedFiles: 0, valid: false, findings, diagnostics };
  }
  let scannedFiles = 0;

  for (const file of files) {
    const result = scanFileForSecretsDetailed(file, patterns);
    findings.push(...result.findings);
    if (result.diagnostic === undefined) {
      scannedFiles += 1;
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  return {
    scannedFiles,
    valid: findings.length === 0 && diagnostics.length === 0,
    findings,
    diagnostics,
  };
}

if (process.argv[1] === __filename) {
  const result = scanRepositoryForSecrets();
  console.log(`Scanned ${result.scannedFiles} tracked files for secrets and API credentials.`);
  if (!result.valid) {
    console.error(
      `Secret scanner failed with ${result.findings.length} potential secret(s) and ${result.diagnostics.length} diagnostic(s):`,
    );
    for (const finding of result.findings) {
      console.error(`- [${finding.rule}] ${finding.file}:${finding.line}`);
    }
    for (const diagnostic of result.diagnostics) {
      console.error(`- [unscanned] ${diagnostic.file}: ${diagnostic.reason}`);
    }
    process.exit(1);
  }
  console.log("No unredacted secrets or private keys detected in repository.");
}
