import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";

import { auditLicenses } from "./licenses.mjs";
import { SECRET_PATTERNS, scanFileForSecrets, scanRepositoryForSecrets } from "./secrets.mjs";

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
});
