/**
 * The counted fields of a project card (#2896): what git and a repository's manifests say about
 * one repository, with no model call. An agent's `/add-project` and the CLI's
 * `evidence add-repo` start from these numbers, so a card's metrics are counted, never
 * estimated. The module reads files only through `readAllowed`, which refuses any path outside
 * the allowlist, and returns no email address.
 */

/** Root files a card may be drawn from; nothing else in the repository is ever read. */
export const repositoryFactFiles = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
] as const;

/** Whether a path is one an agent or this module may read to draft a card. */
export function isAllowedRepositoryFile(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (normalized.includes("..")) return false;
  if ((repositoryFactFiles as readonly string[]).includes(normalized)) return true;
  if (/^(?:README|CHANGELOG|RELEASE_NOTES|RELEASES)(?:\.[A-Za-z]+)?$/u.test(normalized))
    return true;
  if (/^docs\/.+\.mdx?$/u.test(normalized)) return true;
  if (/(?:^|\/)Dockerfile(?:\.[A-Za-z0-9_-]+)?$/u.test(normalized)) return true;
  return /\.tf$/u.test(normalized);
}

export interface RepositoryFactPorts {
  /** Runs git in the repository with these arguments and returns its standard output. */
  readonly git: (args: readonly string[]) => Promise<string>;
  /** Reads one repository file; called only for allowlisted paths, undefined when missing. */
  readonly readFile: (path: string) => Promise<string | undefined>;
}

export interface RepositoryFacts {
  readonly name: string;
  readonly stack: readonly string[];
  readonly contribution: {
    readonly own_commits: number;
    readonly total_commits: number;
    readonly first_commit: string;
    readonly last_commit: string;
    readonly other_contributors: number;
  };
  readonly scale: {
    readonly releases: number;
    readonly continuous_integration: boolean;
    readonly automated_tests: boolean;
  };
  /** The allowlisted files that were read, so the candidate can see nothing else was. */
  readonly files_read: readonly string[];
}

export class RepositoryFactsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryFactsError";
  }
}

/** Technologies named by a dependency in `package.json`, in a fixed order. */
const packageTechnologies: readonly (readonly [string, string])[] = [
  ["typescript", "TypeScript"],
  ["react", "React"],
  ["next", "Next.js"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["electron", "Electron"],
  ["zod", "Zod"],
  ["pg", "PostgreSQL"],
  ["better-sqlite3", "SQLite"],
  ["vitest", "Vitest"],
  ["jest", "Jest"],
];

const manifestLanguages: readonly (readonly [string, string])[] = [
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["go.mod", "Go"],
  ["Cargo.toml", "Rust"],
  ["Gemfile", "Ruby"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java"],
  ["build.gradle.kts", "Kotlin"],
  ["composer.json", "PHP"],
];

const testPath =
  /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[A-Za-z]+$|_test\.(?:go|py)$|(?:^|\/)test_[^/]+\.py$/u;
const releaseTag = /^v?\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/u;

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Counts one repository's card fields from git and its root manifests. `emails` are the
 * candidate's commit emails, matched exactly and case-insensitively; they never appear in the
 * answer.
 */
export async function collectRepositoryFacts(
  ports: RepositoryFactPorts,
  options: { readonly emails: readonly string[]; readonly fallbackName: string },
): Promise<RepositoryFacts> {
  const emails = new Set(options.emails.map((email) => email.trim().toLowerCase()));
  if (emails.size === 0) {
    throw new RepositoryFactsError("Name at least one of the candidate's commit emails.");
  }
  const filesRead: string[] = [];
  const readAllowed = async (path: string) => {
    if (!isAllowedRepositoryFile(path)) {
      throw new RepositoryFactsError("Only allowlisted repository files may be read.");
    }
    const text = await ports.readFile(path);
    if (text !== undefined) filesRead.push(path);
    return text;
  };

  const log = lines(await ports.git(["log", "--no-merges", "--format=%ae%x09%as", "HEAD"]));
  let own = 0;
  const others = new Set<string>();
  const ownDates: string[] = [];
  for (const entry of log) {
    const [email = "", date = ""] = entry.split("\t");
    const author = email.toLowerCase();
    if (emails.has(author)) {
      own += 1;
      ownDates.push(date);
    } else if (author !== "") {
      others.add(author);
    }
  }
  if (own === 0) {
    throw new RepositoryFactsError("No commit in this repository has one of the emails given.");
  }
  ownDates.sort();

  const tracked = lines(await ports.git(["ls-files"]));
  const tags = lines(await ports.git(["tag", "--list"]));

  const stack: string[] = [];
  const add = (technology: string) => {
    if (!stack.includes(technology)) stack.push(technology);
  };
  let name = options.fallbackName;
  const packageJson = await readAllowed("package.json");
  if (packageJson !== undefined) {
    try {
      const manifest = JSON.parse(packageJson) as {
        readonly name?: unknown;
        readonly dependencies?: Record<string, unknown>;
        readonly devDependencies?: Record<string, unknown>;
      };
      if (typeof manifest.name === "string" && manifest.name.trim() !== "") {
        name = manifest.name.trim();
      }
      const dependencies = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]);
      add(dependencies.has("typescript") ? "TypeScript" : "JavaScript");
      add("Node.js");
      for (const [dependency, technology] of packageTechnologies) {
        if (dependencies.has(dependency)) add(technology);
      }
    } catch {
      add("JavaScript");
    }
  }
  for (const [file, language] of manifestLanguages) {
    if (tracked.includes(file) && (await readAllowed(file)) !== undefined) add(language);
  }
  if (tracked.some((path) => /(?:^|\/)Dockerfile(?:\.[A-Za-z0-9_-]+)?$/u.test(path))) {
    add("Docker");
  }
  if (tracked.some((path) => /\.tf$/u.test(path))) add("Terraform");
  if (stack.length === 0) add("Git");

  return {
    name: name.slice(0, 120),
    stack: stack.slice(0, 15),
    contribution: {
      own_commits: own,
      total_commits: log.length,
      first_commit: ownDates[0] ?? "",
      last_commit: ownDates.at(-1) ?? "",
      other_contributors: others.size,
    },
    scale: {
      releases: tags.filter((tag) => releaseTag.test(tag)).length,
      continuous_integration: tracked.some(
        (path) =>
          path.startsWith(".github/workflows/") ||
          path === ".gitlab-ci.yml" ||
          path === "bitbucket-pipelines.yml" ||
          path.startsWith(".circleci/"),
      ),
      automated_tests: tracked.some((path) => testPath.test(path)),
    },
    files_read: filesRead,
  };
}
