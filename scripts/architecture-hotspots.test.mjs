import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { checkHotspotGrowth } from "./architecture-hotspots.mjs";

async function fixture(path, content) {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-hotspots-"));
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return root;
}

test("accepts a hotspot at or below its frozen baseline", async () => {
  const path = "packages/example/src/index.ts";
  const root = await fixture(path, "first\nsecond\n");
  try {
    assert.deepEqual(await checkHotspotGrowth(root, { [path]: 2 }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects growth and missing protected hotspots", async () => {
  const path = "packages/example/src/index.ts";
  const root = await fixture(path, "first\nsecond\nthird\n");
  try {
    assert.deepEqual(await checkHotspotGrowth(root, { [path]: 2, "missing.ts": 1 }), [
      `${path}: 3 lines exceeds the frozen 2-line baseline`,
      "missing.ts: protected hotspot is missing",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
