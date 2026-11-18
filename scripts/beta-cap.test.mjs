import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeSeats, main, parseBetaCapRequest } from "./beta-cap.mjs";

const env = { DRAFT_LOOP_API_URL: "https://api.example.test/", DRAFT_LOOP_OWNER_TOKEN: "t0ken" };
/** A fetch answer with only what the script reads. */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const seats = { redeemed: 3, open: 2, cap: 10, capSource: "operator", deploymentCap: 25 };

describe("pnpm beta:cap", () => {
  test("reads without an argument and sets a whole number", () => {
    assert.deepEqual(parseBetaCapRequest([], env), {
      base: "https://api.example.test",
      token: "t0ken",
    });
    assert.equal(parseBetaCapRequest(["15"], env).cap, 15);
    assert.equal(parseBetaCapRequest(["0"], env).cap, 0);
  });

  test("refuses a bad cap, a missing token and plain http off localhost", () => {
    for (const cap of ["-1", "2.5", "ten", "100001"]) {
      assert.throws(() => parseBetaCapRequest([cap], env), /whole number/u);
    }
    assert.throws(
      () => parseBetaCapRequest([], { DRAFT_LOOP_API_URL: env.DRAFT_LOOP_API_URL }),
      /Usage/u,
    );
    assert.throws(() => parseBetaCapRequest(["1", "2"], env), /Usage/u);
    assert.throws(
      () => parseBetaCapRequest([], { ...env, DRAFT_LOOP_API_URL: "http://api.example.test" }),
      /https/u,
    );
    assert.equal(
      parseBetaCapRequest([], { ...env, DRAFT_LOOP_API_URL: "http://localhost:8080" }).base,
      "http://localhost:8080",
    );
  });

  test("puts the new cap with the owner token and prints the seats, never the token", async () => {
    const calls = [];
    const lines = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init]);
      return answer(200, seats);
    };

    await main(["10"], env, { fetchImpl, out: (line) => lines.push(line) });

    assert.equal(calls[0][0], "https://api.example.test/v1/operator/beta-invites/cap");
    assert.equal(calls[0][1].method, "PUT");
    assert.equal(calls[0][1].headers.authorization, "Bearer t0ken");
    assert.equal(calls[0][1].body, JSON.stringify({ cap: 10 }));
    assert.deepEqual(lines, [
      "Set. Cap 10 (set by the operator): 3 accounts, 2 invites not used yet, 5 seats left.",
    ]);
    assert.ok(!lines.join("").includes("t0ken"));
  });

  test("says what the server refused", async () => {
    const fetchImpl = async () => answer(401, { error: { code: "forbidden" } });
    await assert.rejects(main([], env, { fetchImpl, out: () => {} }), /401 forbidden/u);
    assert.equal(
      describeSeats({ ...seats, capSource: "deployment" }),
      "Cap 10 (from DRAFT_LOOP_BETA_ACCOUNT_CAP (25)): 3 accounts, 2 invites not used yet, 5 seats left.",
    );
  });
});
