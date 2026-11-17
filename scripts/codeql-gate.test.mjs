import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blockingResults } from "./codeql-gate.mjs";

function sarif(rule, result) {
  return { runs: [{ tool: { driver: { rules: [rule] } }, results: [result] }] };
}

const location = {
  physicalLocation: { artifactLocation: { uri: "apps/api/src/a.ts" }, region: { startLine: 3 } },
};

describe("CodeQL gate", () => {
  it("blocks an error-level result", () => {
    const found = blockingResults(
      sarif(
        { id: "js/x", defaultConfiguration: { level: "error" } },
        { ruleId: "js/x", ruleIndex: 0, message: { text: "bad" }, locations: [location] },
      ),
    );
    assert.deepEqual(found, [
      { ruleId: "js/x", message: "bad", file: "apps/api/src/a.ts", line: 3 },
    ]);
  });

  it("blocks a high security-severity warning", () => {
    const found = blockingResults(
      sarif(
        { id: "js/y", properties: { "security-severity": "7.5" } },
        { ruleId: "js/y", level: "warning", message: { text: "risky" } },
      ),
    );
    assert.equal(found.length, 1);
  });

  it("lets a medium warning and a suppressed error through", () => {
    assert.equal(
      blockingResults(
        sarif(
          { id: "js/z", properties: { "security-severity": "5.0" } },
          { ruleId: "js/z", level: "warning", message: { text: "meh" } },
        ),
      ).length,
      0,
    );
    assert.equal(
      blockingResults(
        sarif(
          { id: "js/x", defaultConfiguration: { level: "error" } },
          { ruleId: "js/x", level: "error", suppressions: [{ kind: "inSource" }] },
        ),
      ).length,
      0,
    );
  });
});
