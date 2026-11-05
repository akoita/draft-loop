/* global fetch -- Node 24 provides it. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  acceptanceProof,
  acceptanceToken,
  seedFirstLaunchProfile,
  startFakeServer,
  stopFakeServer,
} from "./desktop-client-acceptance.mjs";

test("the acceptance profile lists this computer without selecting it (#2112)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "draftloop-acceptance-seed-"));
  try {
    const userData = join(directory, "user-data");
    await seedFirstLaunchProfile(userData);
    const list = JSON.parse(await readFile(join(userData, "servers.json"), "utf8"));
    // Nothing selected: the client opens the picker even when a real server answers on 8080.
    assert.deepEqual(list, {
      servers: [{ origin: "http://127.0.0.1:8080", name: "This computer" }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the acceptance's real server proves the token and its impostor cannot (#2148)", async () => {
  const challenge = "c".repeat(64);
  const ask = (port) =>
    fetch(`http://127.0.0.1:${port}/v1/auth/proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge }),
    });
  const real = await startFakeServer();
  const port = real.address().port;
  try {
    const answer = await (await ask(port)).json();
    assert.equal(answer.proof, acceptanceProof(acceptanceToken, challenge));
  } finally {
    await stopFakeServer(real);
  }
  const seen = [];
  const impostor = await startFakeServer({ holdsToken: false, port, seen });
  try {
    assert.equal((await ask(port)).status, 404);
    assert.ok(seen.some((line) => line.startsWith("POST /v1/auth/proof")));
    assert.ok(seen.every((line) => !line.includes(acceptanceToken)));
  } finally {
    await stopFakeServer(impostor);
  }
});

test("the acceptance proof matches the API's test vector", () => {
  // The vector in apps/api/src/owner-token-proof-routes.test.ts.
  assert.equal(
    acceptanceProof("owner-token-for-tests-0123456789abcdef", "a".repeat(64)),
    "2b67acf4f712c7daf9a943d7ebb52c001afb0a9390b9b9fdadaa2a2d7498ba7d",
  );
});
