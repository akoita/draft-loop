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
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    });
    return output
      .split("\0")
      .filter((f) => f.length > 0)
      .map((f) => join(root, f));
  } catch {
    return [];
  }
}

export function scanFileForSecrets(filePath, patterns = SECRET_PATTERNS) {
  if (!existsSync(filePath)) {
    return [];
  }
  const stat = statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) {
    // Skip large binary / generated files
    return [];
  }

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return []; // Binary or unreadable
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

  return findings;
}

export function scanRepositoryForSecrets(root = rootDir, patterns = SECRET_PATTERNS) {
  const files = getTrackedFiles(root);
  const findings = [];

  for (const file of files) {
    const fileFindings = scanFileForSecrets(file, patterns);
    findings.push(...fileFindings);
  }

  return {
    scannedFiles: files.length,
    valid: findings.length === 0,
    findings,
  };
}

if (process.argv[1] === __filename) {
  const result = scanRepositoryForSecrets();
  console.log(`Scanned ${result.scannedFiles} tracked files for secrets and API credentials.`);
  if (!result.valid) {
    console.error(`Secret scanner detected ${result.findings.length} potential secret(s):`);
    for (const finding of result.findings) {
      console.error(`- [${finding.rule}] ${finding.file}:${finding.line}`);
    }
    process.exit(1);
  }
  console.log("No unredacted secrets or private keys detected in repository.");
}
