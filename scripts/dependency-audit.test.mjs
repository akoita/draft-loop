import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { evaluateAudit, parseAcceptList } from "./dependency-audit.mjs";

function report(...advisories) {
  return {
    advisories: Object.fromEntries(
      advisories.map(([id, severity, module], index) => [
        String(index + 1),
        { id: index + 1, github_advisory_id: id, severity, module_name: module, title: "t" },
      ]),
    ),
  };
}

const TODAY = "2026-11-17";

describe("dependency advisory gate", () => {
  test("fails on an unaccepted high production advisory", () => {
    const prodReport = report(["GHSA-aaaa", "high", "left-pad"]);
    const result = evaluateAudit({
      prodReport,
      fullReport: prodReport,
      accepted: [],
      today: TODAY,
    });
    assert.equal(result.passed, false);
    assert.equal(result.failures[0].why, "not accepted");
  });

  test("ignores low and moderate production advisories", () => {
    const prodReport = report(["GHSA-low", "low", "a"], ["GHSA-mod", "moderate", "b"]);
    const result = evaluateAudit({
      prodReport,
      fullReport: prodReport,
      accepted: [],
      today: TODAY,
    });
    assert.equal(result.passed, true);
  });

  test("passes an accepted advisory until its expiry date, then fails", () => {
    const prodReport = report(["GHSA-aaaa", "critical", "left-pad"]);
    const accepted = [{ id: "GHSA-aaaa", reason: "No fixed version yet", expires: TODAY }];
    const open = evaluateAudit({ prodReport, fullReport: prodReport, accepted, today: TODAY });
    assert.equal(open.passed, true);
    assert.equal(open.accepted[0].reason, "No fixed version yet");
    const late = evaluateAudit({
      prodReport,
      fullReport: prodReport,
      accepted,
      today: "2026-11-18",
    });
    assert.equal(late.passed, false);
    assert.match(late.failures[0].why, /expired on 2026-11-17/u);
  });

  test("warns on a development-only high advisory without failing", () => {
    const result = evaluateAudit({
      prodReport: report(),
      fullReport: report(["GHSA-dev", "high", "extract-zip"]),
      accepted: [],
      today: TODAY,
    });
    assert.equal(result.passed, true);
    assert.deepEqual(
      result.warnings.map((a) => a.id),
      ["GHSA-dev"],
    );
  });

  test("names an acceptance whose advisory no longer appears", () => {
    const result = evaluateAudit({
      prodReport: report(),
      fullReport: report(),
      accepted: [{ id: "GHSA-gone", reason: "Fixed upstream since", expires: "2026-12-01" }],
      today: TODAY,
    });
    assert.deepEqual(
      result.stale.map((entry) => entry.id),
      ["GHSA-gone"],
    );
  });

  test("refuses an acceptance without a reason or an expiry date", () => {
    const { entries, problems } = parseAcceptList([
      { id: "GHSA-a", reason: "", expires: "2026-12-01" },
      { id: "GHSA-b", reason: "Waiting on upstream fix", expires: "soon" },
      { id: "GHSA-c", reason: "Waiting on upstream fix", expires: "2026-12-01" },
    ]);
    assert.equal(problems.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ["GHSA-c"],
    );
    assert.equal(parseAcceptList({}).problems.length, 1);
  });
});
