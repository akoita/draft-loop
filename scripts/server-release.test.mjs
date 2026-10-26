import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  main,
  markProduction,
  renderServerReleaseNotes,
  SERVER_RELEASE_FILE,
  serverReleaseTitle,
  validateServerReleaseMetadata,
} from "./server-release.mjs";

const metadata = Object.freeze({
  project: "draft-loop",
  stage: "client-server-version",
  channel: "staging",
  releaseName: "Example sprint",
  stageIssue: 1359,
  milestone: 53,
  summary: "Hosted service, example sprint: one change.",
  knownLimitations: "Staging only.",
});
const commit = "cf33930aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const validationUrl = "https://github.com/akoita/draft-loop/actions/runs/1";

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function capture() {
  let text = "";
  return { write: (chunk) => (text += chunk), text: () => text };
}

describe("server release metadata", () => {
  test("the repository's own server-release.json is valid", () => {
    const own = JSON.parse(readFileSync(SERVER_RELEASE_FILE, "utf8"));
    assert.deepEqual(validateServerReleaseMetadata(own), []);
  });

  test("names every missing or malformed field", () => {
    assert.deepEqual(validateServerReleaseMetadata({ ...metadata, summary: " ", milestone: 0 }), [
      "summary must be a non-empty string",
      "milestone must be a positive integer",
    ]);
    assert.deepEqual(validateServerReleaseMetadata([]), [
      "server-release.json must contain a JSON object",
    ]);
  });

  test("refuses cloud identifiers and email addresses in public notes", () => {
    const problems = validateServerReleaseMetadata({
      ...metadata,
      summary: "Deployed by the draft-loop-iac workflow to api-abc.a.run.app.",
      knownLimitations: "Ask someone@example.com.",
    });
    assert.deepEqual(problems, [
      "summary names the private infrastructure repository",
      "summary names a Cloud Run address",
      "knownLimitations names an email address",
    ]);
  });
});

describe("server release notes", () => {
  test("titles the release as the hosted service", () => {
    assert.equal(
      serverReleaseTitle(metadata, "server-v0.5.0"),
      "Hosted service: Example sprint server-v0.5.0",
    );
    assert.throws(() => serverReleaseTitle(metadata, "v0.5.0"), /not server-vX\.Y\.Z/);
  });

  test("renders the desktop releases' layout", () => {
    assert.equal(
      renderServerReleaseNotes(metadata, { tag: "server-v0.5.0", commit, validationUrl }),
      [
        "Roadmap stage: client-server-version",
        "Channel: staging",
        `Source commit: ${commit}`,
        "",
        `Validation: ${validationUrl} (CI on the source commit); the synthetic smoke passed on staging.`,
        "Stage issue: https://github.com/akoita/draft-loop/issues/1359",
        "Milestone: https://github.com/akoita/draft-loop/milestone/53",
        "SBOM: CycloneDX JSON is attached to the release.",
        "Hosted service, example sprint: one change.",
        "",
        "Known limitations: Staging only.",
        "",
      ].join("\n"),
    );
  });

  test("links validation only to a public CI run and takes only a full sha", () => {
    const tag = "server-v0.5.0";
    assert.throws(
      () =>
        renderServerReleaseNotes(metadata, { tag, commit, validationUrl: "https://example.com/1" }),
      /CI run of the public repository/,
    );
    assert.throws(
      () => renderServerReleaseNotes(metadata, { tag, commit: "cf33930", validationUrl }),
      /not a full commit sha/,
    );
  });

  test("marks production once, under the channel", () => {
    const body = "Roadmap stage: x\nChannel: staging\nSource commit: y\n";
    const marked = markProduction(body, "2026-10-27");
    assert.equal(
      marked,
      "Roadmap stage: x\nChannel: staging\nProduction: deployed on 2026-10-27.\nSource commit: y\n",
    );
    assert.equal(markProduction(marked, "2026-10-28"), marked);
    assert.throws(() => markProduction(body, "27/10/2026"), /not YYYY-MM-DD/);
  });
});

describe("server release command", () => {
  test("writes notes from a metadata file and reports bad input with exit code 1", () => {
    const directory = mkdtempSync(join(tmpdir(), "draft-loop-server-release-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "metadata.json");
    const notes = join(directory, "notes.md");
    writeFileSync(file, JSON.stringify(metadata), "utf8");
    const args = ["--tag", "server-v0.5.0", "--commit", commit, "--validation", validationUrl];
    assert.equal(main(["notes", ...args, "--metadata", file, "--output", notes]), 0);
    assert.match(readFileSync(notes, "utf8"), /^Roadmap stage: client-server-version\n/);

    const stdout = capture();
    assert.equal(main(["title", "--tag", "server-v0.5.0", "--metadata", file], { stdout }), 0);
    assert.equal(stdout.text(), "Hosted service: Example sprint server-v0.5.0\n");

    const stderr = capture();
    writeFileSync(file, JSON.stringify({ ...metadata, stageIssue: "x" }), "utf8");
    assert.equal(main(["check", "--metadata", file], { stderr }), 1);
    assert.match(stderr.text(), /stageIssue must be a positive integer/);
    assert.equal(main(["unknown"], { stderr }), 2);
  });
});
