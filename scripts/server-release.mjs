#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Notes for a server-vX.Y.Z GitHub Release (ADR 0011, D2). The infrastructure repository's
// release workflow renders them with this script once the staging smoke passes, so the words
// live here, in `server-release.json`, and the cloud identifiers stay over there.
export const SERVER_RELEASE_FILE = "server-release.json";
const REPOSITORY_URL = "https://github.com/akoita/draft-loop";
const TAG_PATTERN = /^server-v\d+\.\d+\.\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_FIELDS = ["stage", "channel", "releaseName", "summary", "knownLimitations"];
const NUMBER_FIELDS = ["stageIssue", "milestone"];

// The notes are public: none of these may appear in them (AGENTS.md, Data, privacy, and model rules).
const FORBIDDEN_TEXT = [
  [/draft-loop-iac/i, "the private infrastructure repository"],
  [/gserviceaccount\.com/i, "a service account"],
  [/\.run\.app\b/i, "a Cloud Run address"],
  [/\bprojects\/[a-z][a-z0-9-]+/i, "a cloud project path"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "an email address"],
];

export class ServerReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServerReleaseError";
  }
}

/** Returns the problems in a server-release.json object; an empty list means it is valid. */
export function validateServerReleaseMetadata(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [`${SERVER_RELEASE_FILE} must contain a JSON object`];
  }
  const problems = [];
  if (metadata.project !== "draft-loop") problems.push('project must be "draft-loop"');
  for (const field of TEXT_FIELDS) {
    if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
      problems.push(`${field} must be a non-empty string`);
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (!Number.isInteger(metadata[field]) || metadata[field] < 1) {
      problems.push(`${field} must be a positive integer`);
    }
  }
  for (const field of TEXT_FIELDS) {
    if (typeof metadata[field] !== "string") continue;
    for (const [pattern, label] of FORBIDDEN_TEXT) {
      if (pattern.test(metadata[field])) problems.push(`${field} names ${label}`);
    }
  }
  return problems;
}

function requireValid(metadata) {
  const problems = validateServerReleaseMetadata(metadata);
  if (problems.length > 0) throw new ServerReleaseError(problems.join("; "));
  return metadata;
}

function requireTag(tag) {
  if (!TAG_PATTERN.test(tag ?? "")) throw new ServerReleaseError(`${tag} is not server-vX.Y.Z`);
  return tag;
}

/** The release title, marked as the hosted service so it never reads as a desktop release. */
export function serverReleaseTitle(metadata, tag) {
  return `Hosted service: ${requireValid(metadata).releaseName} ${requireTag(tag)}`;
}

/** The notes above GitHub's generated "What's Changed", in the desktop releases' layout. */
export function renderServerReleaseNotes(metadata, { tag, commit, validationUrl }) {
  requireValid(metadata);
  requireTag(tag);
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
    throw new ServerReleaseError(`${commit} is not a full commit sha`);
  }
  if (!(validationUrl ?? "").startsWith(`${REPOSITORY_URL}/actions/runs/`)) {
    throw new ServerReleaseError("the validation link must be a CI run of the public repository");
  }
  const lines = [
    `Roadmap stage: ${metadata.stage}`,
    `Channel: ${metadata.channel}`,
    `Source commit: ${commit}`,
    "",
    `Validation: ${validationUrl} (CI on the source commit); the synthetic smoke passed on staging.`,
    `Stage issue: ${REPOSITORY_URL}/issues/${metadata.stageIssue}`,
    `Milestone: ${REPOSITORY_URL}/milestone/${metadata.milestone}`,
    "SBOM: CycloneDX JSON is attached to the release.",
    metadata.summary.trim(),
    "",
    `Known limitations: ${metadata.knownLimitations.trim()}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Adds the production line after the channel line; a body that already has one is unchanged. */
export function markProduction(body, date) {
  if (!DATE_PATTERN.test(date ?? "")) throw new ServerReleaseError(`${date} is not YYYY-MM-DD`);
  if (/^Production: /m.test(body)) return body;
  const lines = body.split("\n");
  const channel = lines.findIndex((line) => line.startsWith("Channel: "));
  if (channel === -1) throw new ServerReleaseError("the release notes have no Channel line");
  lines.splice(channel + 1, 0, `Production: deployed on ${date}.`);
  return lines.join("\n");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name.startsWith("--") || args[index + 1] === undefined) {
      throw new ServerReleaseError(`expected --name value pairs, got ${name}`);
    }
    options[name.slice(2)] = args[index + 1];
  }
  return options;
}

function readMetadata(options) {
  const path = options.metadata ?? SERVER_RELEASE_FILE;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ServerReleaseError(`cannot read ${path}: ${error.message}`);
  }
}

function output(text, options, stdout) {
  if (options.output) writeFileSync(options.output, text, "utf8");
  else stdout.write(text);
}

const USAGE = `Usage:
  server-release.mjs check [--metadata file]
  server-release.mjs title --tag server-vX.Y.Z [--metadata file]
  server-release.mjs notes --tag server-vX.Y.Z --commit sha --validation url [--metadata file] [--output file]
  server-release.mjs production --body file --date YYYY-MM-DD [--output file]
`;

export function main(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const [command, ...rest] = args;
  try {
    const options = parseOptions(rest);
    if (command === "check") {
      requireValid(readMetadata(options));
      stdout.write(`${options.metadata ?? SERVER_RELEASE_FILE} is valid.\n`);
    } else if (command === "title") {
      stdout.write(`${serverReleaseTitle(readMetadata(options), options.tag)}\n`);
    } else if (command === "notes") {
      const notes = renderServerReleaseNotes(readMetadata(options), {
        tag: options.tag,
        commit: options.commit,
        validationUrl: options.validation,
      });
      output(notes, options, stdout);
    } else if (command === "production") {
      output(markProduction(readFileSync(options.body, "utf8"), options.date), options, stdout);
    } else {
      stderr.write(USAGE);
      return 2;
    }
    return 0;
  } catch (error) {
    if (!(error instanceof ServerReleaseError)) throw error;
    stderr.write(`server-release: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
