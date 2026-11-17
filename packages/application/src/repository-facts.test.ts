import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectRepositoryFacts,
  isAllowedRepositoryFile,
  type RepositoryFactPorts,
} from "./repository-facts.js";

const run = promisify(execFile);

// A fictional repository with two fictional authors.
const candidate = "sam@tidewater.example";
const other = "lee@tidewater.example";

let root: string;
const reads: string[] = [];

async function git(args: readonly string[], env: Record<string, string> = {}): Promise<string> {
  return (
    await run("git", ["-C", root, ...args], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: root, ...env },
      encoding: "utf8",
    })
  ).stdout;
}

async function commit(file: string, text: string, email: string, date: string) {
  await mkdir(join(root, file, ".."), { recursive: true });
  await writeFile(join(root, file), text);
  await git(["add", file]);
  await git(["commit", "-q", "-m", `Change ${file}`], {
    GIT_AUTHOR_NAME: "Author",
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: `${date}T10:00:00Z`,
    GIT_COMMITTER_NAME: "Author",
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: `${date}T10:00:00Z`,
  });
}

const ports = (): RepositoryFactPorts => ({
  git: (args) => git(args),
  readFile: async (path) => {
    reads.push(path);
    return readFile(join(root, path), "utf8").catch(() => undefined);
  },
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-repo-facts-"));
  await git(["init", "-q", "-b", "main"]);
  await commit(
    "package.json",
    JSON.stringify({ name: "tidewater", devDependencies: { typescript: "5", vitest: "3" } }),
    candidate,
    "2025-10-02",
  );
  await commit("src/plan.ts", "export const plan = 1;\n", candidate, "2025-11-15");
  await commit("src/plan.test.ts", "// test\n", other, "2026-01-04");
  await commit(".github/workflows/ci.yml", "on: push\n", candidate, "2026-03-20");
  await commit("Dockerfile", "FROM node:24\n", "SAM@tidewater.example", "2026-11-10");
  await git(["tag", "v1.0.0"]);
  await git(["tag", "not-a-release"]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("repository facts", () => {
  it("counts the candidate's commits from git and reads only allowlisted files", async () => {
    const facts = await collectRepositoryFacts(ports(), {
      emails: [candidate],
      fallbackName: "fallback",
    });
    const authors = (await git(["log", "--no-merges", "--format=%ae"])).trim().split("\n");
    const own = authors.filter((email) => email.toLowerCase() === candidate).length;
    expect(facts).toEqual({
      name: "tidewater",
      stack: ["TypeScript", "Node.js", "Vitest", "Docker"],
      contribution: {
        own_commits: own,
        total_commits: authors.length,
        first_commit: "2025-10-02",
        last_commit: "2026-11-10",
        other_contributors: 1,
      },
      scale: { releases: 1, continuous_integration: true, automated_tests: true },
      files_read: ["package.json"],
    });
    expect(own).toBe(4);
    expect(reads.every(isAllowedRepositoryFile)).toBe(true);
    expect(reads).not.toContain("src/plan.ts");
    expect(JSON.stringify(facts)).not.toContain("@");
  });

  it("refuses when no commit has the emails given", async () => {
    await expect(
      collectRepositoryFacts(ports(), { emails: ["nobody@example.test"], fallbackName: "x" }),
    ).rejects.toThrow("No commit");
  });

  it("allows only README, docs Markdown, manifests, Dockerfiles, Terraform and release notes", () => {
    for (const path of ["README.md", "docs/guide.md", "go.mod", "Dockerfile", "infra/main.tf"]) {
      expect(isAllowedRepositoryFile(path), path).toBe(true);
    }
    for (const path of ["src/index.ts", ".env", "docs/../src/a.ts", "secrets.json", "id_rsa"]) {
      expect(isAllowedRepositoryFile(path), path).toBe(false);
    }
  });
});
