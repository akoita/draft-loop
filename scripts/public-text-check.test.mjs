import assert from "node:assert/strict";
import console from "node:console";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";

import { eventTexts, main, parseDenylist, scanPublicText } from "./public-text-check.mjs";

const rules = (text, options) => scanPublicText(text, options).map((finding) => finding.rule);

describe("public text check", () => {
  test("flags private identifiers, contacts and cloud names", () => {
    const cases = {
      "Identifier (UUID)": "run 3f2b8c1e-5a4d-4c2b-9e1f-7a6b5c4d3e2f failed",
      "Trace or request id (32 hex)": "trace 4bf92f3577b34da6a3ce929d0e0e4736",
      "Email address or service account": "contact jane.doe@gmail.com",
      "Cloud Storage bucket": "copied to gs://acme-prod-blobs/x",
      "Cloud Run host": "see https://api-abc123xyz0-ew.a.run.app/health",
      "Cloud project path": "projects/acme-prod-4821/secrets",
      "Cloud SQL connection name": "acme-prod-4821:europe-west1:main-db",
      "Public IP address": "egress from 34.76.10.12",
      "Phone number": "call +33 6 12 34 56 78",
    };
    for (const [rule, text] of Object.entries(cases)) {
      assert.deepEqual(rules(text), [rule], text);
    }
    assert.deepEqual(rules("x@acme.iam.gserviceaccount.com"), ["Email address or service account"]);
    assert.deepEqual(rules("tel 06 12 34 56 78"), ["Phone number"]);
  });

  test("keeps codes, counts, versions, citations and example data", () => {
    const safe = [
      "failure:author:claude-haiku-5-5:invalid-response:max_tokens seen 4 times in 31 runs",
      "server-v0.26.11, commit 01ed6b9 and 66ab896d4b0e3f8a1c2d3e4f5a6b7c8d9e0f1a2b",
      "packages/application/src/quality-digest.ts:42",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "candidate@example.test, Example Ledger, ops@northwind.example",
      "pnpm --filter @draft-loop/api openapi; mermaid@11.4.1; actions/checkout@v7",
      "listen on 127.0.0.1:55432 or 10.0.0.4; docs range 192.0.2.10",
      "nil id 00000000-0000-0000-0000-000000000000",
      "Chrome 120.0.6099.109 and 1,240 tests",
      "gs://<bucket> and projects/<project>",
    ];
    for (const text of safe) {
      assert.deepEqual(rules(text), [], text);
    }
  });

  test("strict mode refuses quoted passages", () => {
    const quote = '"I led the migration of the payments platform to the new stack"';
    assert.deepEqual(rules(quote), []);
    assert.deepEqual(rules(quote, { strict: true }), ["Quoted passage"]);
    assert.deepEqual(
      rules("> The member wrote a long note about the critic being wrong here", { strict: true }),
      ["Quoted passage (blockquote)"],
    );
    assert.deepEqual(rules('code "short"', { strict: true }), []);
  });

  test("matches the private deny-list without case", () => {
    const denylist = parseDenylist("Acme-Prod-4821, internal-host\nab");
    assert.deepEqual(denylist, ["Acme-Prod-4821", "internal-host"]);
    assert.deepEqual(rules("deployed to ACME-PROD-4821 today", { denylist }), [
      "Private deny-list term",
    ]);
  });

  test("reports the line and field, never the value", () => {
    const findings = scanPublicText("ok\nmail jane.doe@gmail.com", { field: "issue body" });
    assert.deepEqual(findings, [
      { rule: "Email address or service account", line: 2, field: "issue body" },
    ]);
    assert.ok(!JSON.stringify(findings).includes("jane"));
  });

  test("reads the text fields of a GitHub event", () => {
    const texts = eventTexts({
      issue: { title: "Title", body: "Body", number: 4 },
      comment: { body: "Comment" },
      sender: { login: "someone" },
    });
    assert.deepEqual(
      texts.map((entry) => entry.field),
      ["issue title", "issue body", "comment"],
    );
  });

  test("exits non-zero on a hit and zero on clean text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "public-text-"));
    const event = join(dir, "event.json");
    await writeFile(event, JSON.stringify({ pull_request: { title: "t", body: "x 34.76.10.12" } }));
    const errors = [];
    const original = console.error;
    console.error = (line) => errors.push(line);
    try {
      assert.equal(main(["--github-event"], { GITHUB_EVENT_PATH: event }), 1);
      assert.ok(errors.every((line) => !line.includes("34.76")));
      await writeFile(event, JSON.stringify({ issue: { title: "t", body: "max_tokens x4" } }));
      assert.equal(main(["--github-event"], { GITHUB_EVENT_PATH: event }), 0);
    } finally {
      console.error = original;
    }
  });
});
