import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";
import { URL } from "node:url";

import { auditLicenses, isLicenseAllowed } from "./licenses.mjs";
import {
  SECRET_PATTERNS,
  scanFileForSecrets,
  scanFileForSecretsDetailed,
  scanRepositoryForSecrets,
} from "./secrets.mjs";

async function createAuditWorkspace(dependencies = {}) {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-license-test-"));
  await Promise.all([
    mkdir(join(root, "apps")),
    mkdir(join(root, "packages")),
    mkdir(join(root, "node_modules")),
  ]);
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies }));
  return root;
}

function git(root, ...args) {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

describe("supply chain and license compliance quality gates", () => {
  test("audits root and packages for approved permissive licenses", () => {
    const report = auditLicenses();
    assert.equal(report.valid, true, "monorepo dependencies must comply with allowed licenses");
    assert.ok(report.auditedDependencies.length > 0, "must audit direct dependencies");
  });

  test("flags disallowed non-permissive licenses", () => {
    const customAllowed = new Set(["MIT"]);
    const report = auditLicenses(undefined, customAllowed);
    // TypeScript, Biome, or ESLint use Apache-2.0 or other licenses
    assert.ok(report.issues.length > 0, "must flag licenses not in the restricted set");
  });

  test("evaluates SPDX-like AND, OR, and parenthesized expressions", () => {
    const mitOnly = new Set(["MIT"]);
    const mitAndBsd = new Set(["MIT", "BSD-3-Clause"]);

    assert.equal(isLicenseAllowed("MIT AND Apache-2.0", mitOnly), false);
    assert.equal(isLicenseAllowed("MIT OR Apache-2.0", mitOnly), true);
    assert.equal(isLicenseAllowed("(MIT OR Apache-2.0) AND BSD-3-Clause", mitAndBsd), true);
    assert.equal(isLicenseAllowed("MIT OR (Apache-2.0 AND GPL-3.0-only)", mitOnly), true);
    assert.equal(isLicenseAllowed("MIT AND (Apache-2.0 OR GPL-3.0-only)", mitOnly), false);
    assert.equal(isLicenseAllowed("MIT AND", mitOnly), false);
  });

  test("fails closed when a direct dependency cannot be resolved", async () => {
    const root = await createAuditWorkspace({ "missing-package": "1.0.0" });
    try {
      const report = auditLicenses(root);
      assert.equal(report.valid, false);
      assert.match(report.issues[0]?.reason ?? "", /was not found/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed when a workspace manifest cannot be parsed", async () => {
    const root = await createAuditWorkspace();
    try {
      await writeFile(join(root, "package.json"), "{not-json");
      const report = auditLicenses(root);
      assert.equal(report.valid, false);
      assert.match(report.issues[0]?.reason ?? "", /unreadable or invalid/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("secret and credential scanning quality gate", () => {
  test("scans tracked repository files with zero detected secrets", () => {
    const result = scanRepositoryForSecrets();
    assert.equal(result.valid, true, "tracked files must not contain secrets");
    assert.equal(result.findings.length, 0);
  });

  test("detects synthetic secrets across all defined signature patterns", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "draft-loop-secret-test-"));
    const secretFile = join(tempDir, "compromised.txt");

    try {
      const syntheticSecrets = [
        [
          "sk-ant-api03-",
          "abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678901234567890",
        ].join(""),
        ["sk-proj-", "1234567890abcdef1234567890abcdef1234567890abcdef12345678901234567890"].join(
          "",
        ),
        ["ghp_", "1234567890abcdefghijklmnopqrstuvwxyz"].join(""),
        ["AKIA", "IOSFODNN7EXAMPLE"].join(""),
        ["-----BEGIN ", "RSA PRIVATE KEY-----"].join(""),
      ];

      for (const secret of syntheticSecrets) {
        await writeFile(secretFile, `const key = "${secret}";\n`);
        const findings = scanFileForSecrets(secretFile, SECRET_PATTERNS);
        assert.ok(findings.length >= 1, `Must detect secret pattern: ${secret}`);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("fails closed when git discovery fails or returns no tracked files", async () => {
    const nonRepository = await mkdtemp(join(tmpdir(), "draft-loop-not-git-"));
    const emptyRepository = await mkdtemp(join(tmpdir(), "draft-loop-empty-git-"));
    try {
      const discoveryFailure = scanRepositoryForSecrets(nonRepository);
      assert.equal(discoveryFailure.valid, false);
      assert.match(discoveryFailure.diagnostics[0]?.reason ?? "", /discovery failed/u);

      git(emptyRepository, "init", "--quiet");
      const emptyFailure = scanRepositoryForSecrets(emptyRepository);
      assert.equal(emptyFailure.valid, false);
      assert.match(emptyFailure.diagnostics[0]?.reason ?? "", /returned no files/u);
    } finally {
      await Promise.all([
        rm(nonRepository, { recursive: true, force: true }),
        rm(emptyRepository, { recursive: true, force: true }),
      ]);
    }
  });

  test("reports tracked files that disappear instead of silently skipping them", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-missing-tracked-"));
    const trackedFile = join(root, "tracked.txt");
    try {
      git(root, "init", "--quiet");
      await writeFile(trackedFile, "safe content\n");
      git(root, "add", "tracked.txt");
      await rm(trackedFile);

      const report = scanRepositoryForSecrets(root);
      assert.equal(report.valid, false);
      assert.equal(report.scannedFiles, 0);
      assert.match(report.diagnostics[0]?.reason ?? "", /missing/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports files skipped by the scan size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-large-secret-scan-"));
    const largeFile = join(root, "large.txt");
    try {
      await writeFile(largeFile, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
      const result = scanFileForSecretsDetailed(largeFile);
      assert.equal(result.findings.length, 0);
      assert.match(result.diagnostic?.reason ?? "", /exceeds the 2 MiB scan limit/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("desktop content security policy", () => {
  test("blocks remote scripts and active embedded content", async () => {
    const html = await readFile(new URL("../apps/desktop/index.html", import.meta.url), "utf8");
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(html)?.[1];

    assert.ok(policy, "desktop HTML must declare a Content Security Policy");
    assert.match(policy, /default-src 'self'/u);
    assert.match(policy, /script-src 'self'/u);
    assert.match(policy, /object-src 'none'/u);
    assert.match(policy, /frame-ancestors 'none'/u);
    assert.doesNotMatch(policy, /script-src[^;]*(?:https?:|'unsafe-inline'|'unsafe-eval')/u);
  });
});
