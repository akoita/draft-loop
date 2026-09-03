import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const hotspotLineLimits = Object.freeze({
  "packages/application/src/knowledge-base.ts": 6_168,
  "packages/application/src/local.ts": 4_019,
  "packages/domain/src/index.ts": 5_693,
  "packages/schemas/src/index.ts": 4_936,
  "packages/storage/src/index.ts": 14_944,
  "packages/storage/src/knowledge-store.ts": 6_004,
});

function lineCount(content) {
  if (content.length === 0) return 0;
  const breaks = content.match(/\n/gu)?.length ?? 0;
  return breaks + (content.endsWith("\n") ? 0 : 1);
}

export async function checkHotspotGrowth(root, limits = hotspotLineLimits) {
  const violations = [];
  for (const [path, limit] of Object.entries(limits)) {
    let content;
    try {
      content = await readFile(resolve(root, path), "utf8");
    } catch {
      violations.push(`${path}: protected hotspot is missing`);
      continue;
    }
    const lines = lineCount(content);
    if (lines > limit) {
      violations.push(`${path}: ${lines} lines exceeds the frozen ${limit}-line baseline`);
    }
  }
  return violations;
}

async function main() {
  const violations = await checkHotspotGrowth(process.cwd());
  if (violations.length === 0) {
    process.stdout.write(
      `Verified ${Object.keys(hotspotLineLimits).length} frozen architecture hotspots.\n`,
    );
    return;
  }
  process.stderr.write(
    `Architecture hotspot growth is not allowed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
