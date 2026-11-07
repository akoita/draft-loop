import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { checkFeatureCatalog, mcpToolNames, parseCatalog } from "./feature-catalog.mjs";

const catalog = (rows) =>
  [
    "# Feature catalog",
    "",
    "| Feature | Status | Where it runs | Agent access | What it does |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-catalog-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

async function check(files) {
  const root = await fixture(files);
  try {
    return await checkFeatureCatalog(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const page = (status) => `---\nstatus: ${status}\n---\n\n# Journal\n`;
const server =
  'server.registerTool(\n  "record_work",\n  {});\nserver.registerTool("list_work", {});\n';

test("parses rows, links, statuses and tools from Feature tables only", () => {
  const rows = parseCatalog(
    [
      "| Status | Meaning |",
      "| --- | --- |",
      "| `available` | Works |",
      "",
      "| Feature | Status | Where it runs | Agent access | What it does |",
      "| --- | --- | --- | --- | --- |",
      "| [Journal](journal.md#top) | `available` | server | `record_work`, `list_work` | Notes |",
      "| Folders | `planned` | server | `none` | Groups |",
    ].join("\n"),
  );
  assert.deepEqual(rows, [
    {
      feature: "Journal",
      link: "journal.md",
      status: "available",
      tools: ["record_work", "list_work"],
    },
    { feature: "Folders", link: undefined, status: "planned", tools: [] },
  ]);
  assert.deepEqual(mcpToolNames(server), ["record_work", "list_work"]);
});

test("accepts a catalog whose rows, pages and tools agree", async () => {
  assert.deepEqual(
    await check({
      "docs/features/README.md": catalog([
        "| [Journal](journal.md) | `available` | server | `record_work`, `list_work` | Notes |",
      ]),
      "docs/features/journal.md": page("available"),
      "apps/mcp/src/server.ts": server,
    }),
    [],
  );
});

test("rejects broken links, unknown statuses, unlisted pages, drift and unlisted tools", async () => {
  const violations = await check({
    "docs/features/README.md": catalog([
      "| [Journal](journal.md) | `partial` | server | `record_work` | Notes |",
      "| [Gone](missing.md) | `available` | server | `none` | Lost |",
      "| Folders | `soon` | server | `none` | Groups |",
    ]),
    "docs/features/journal.md": page("available"),
    "docs/features/orphan.md": page("available"),
    "apps/mcp/src/server.ts": server,
  });
  assert.deepEqual(violations, [
    "Gone: link missing.md does not resolve",
    "Folders: status must be one of available, partial, planned, retired",
    "docs/features/journal.md: front matter status available differs from its row (partial)",
    "docs/features/orphan.md: not listed in the catalog",
    "MCP tool list_work: not named in any Agent access cell",
  ]);
});
