import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seedFirstLaunchProfile } from "./desktop-client-acceptance.mjs";

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
