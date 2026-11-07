import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const catalogPath = "docs/features/README.md";
export const mcpServerPath = "apps/mcp/src/server.ts";
export const statuses = Object.freeze(["available", "partial", "planned", "retired"]);

const featureHeader = /^\|\s*Feature\s*\|/u;
const separator = /^\|[\s:|-]+\|$/u;

function cells(line) {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Reads the rows of every table whose first header cell is "Feature". */
export function parseCatalog(markdown) {
  const rows = [];
  let columns;
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) {
      columns = undefined;
      continue;
    }
    if (featureHeader.test(line)) {
      columns = cells(line);
      continue;
    }
    if (columns === undefined || separator.test(line.trim())) continue;
    const values = cells(line);
    const row = Object.fromEntries(columns.map((name, index) => [name, values[index] ?? ""]));
    const link = /\[([^\]]+)\]\(([^)#\s]+)(?:#[^)]*)?\)/u.exec(row.Feature ?? "");
    rows.push({
      feature: link?.[1] ?? row.Feature,
      link: link?.[2],
      status: /`([a-z-]+)`/u.exec(row.Status ?? "")?.[1],
      tools: [...(row["Agent access"] ?? "").matchAll(/`([a-z_]+)`/gu)]
        .map((match) => match[1])
        .filter((tool) => tool !== "none"),
    });
  }
  return rows;
}

export function mcpToolNames(source) {
  return [...source.matchAll(/registerTool\(\s*["']([a-z_]+)["']/gu)].map((match) => match[1]);
}

function frontMatterStatus(markdown) {
  const block = /^---\n([\s\S]*?)\n---\n/u.exec(markdown);
  return block === null ? undefined : /^status:\s*([a-z-]+)\s*$/mu.exec(block[1])?.[1];
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function checkFeatureCatalog(root) {
  const violations = [];
  const catalogFile = resolve(root, catalogPath);
  const rows = parseCatalog(await readFile(catalogFile, "utf8"));
  if (rows.length === 0) violations.push(`${catalogPath}: no Feature table found`);

  const linked = new Map();
  for (const row of rows) {
    if (!statuses.includes(row.status ?? "")) {
      violations.push(`${row.feature}: status must be one of ${statuses.join(", ")}`);
    }
    if (row.link === undefined) {
      if (row.status !== "planned") violations.push(`${row.feature}: links no feature page`);
      continue;
    }
    if (/^https?:/u.test(row.link)) continue;
    const target = resolve(dirname(catalogFile), row.link);
    if (!(await exists(target))) {
      violations.push(`${row.feature}: link ${row.link} does not resolve`);
      continue;
    }
    linked.set(target, row);
  }

  const featuresDirectory = dirname(catalogFile);
  for (const name of (await readdir(featuresDirectory)).sort()) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const page = join(featuresDirectory, name);
    const row = linked.get(page);
    if (row === undefined) {
      violations.push(`docs/features/${name}: not listed in the catalog`);
      continue;
    }
    const status = frontMatterStatus(await readFile(page, "utf8"));
    if (status !== row.status) {
      violations.push(
        `docs/features/${name}: front matter status ${status ?? "(missing)"} differs from its row (${row.status})`,
      );
    }
  }

  const listedTools = new Set(rows.flatMap((row) => row.tools));
  // Tools are registered in the server file and in the modules beside it (#2440).
  const serverFile = resolve(root, mcpServerPath);
  if (await exists(serverFile)) {
    const sourceDirectory = dirname(serverFile);
    const sources = (await readdir(sourceDirectory))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();
    for (const name of sources) {
      for (const tool of mcpToolNames(await readFile(join(sourceDirectory, name), "utf8"))) {
        if (!listedTools.has(tool)) {
          violations.push(`MCP tool ${tool}: not named in any Agent access cell`);
        }
      }
    }
  }
  return violations;
}

async function main() {
  const violations = await checkFeatureCatalog(process.cwd());
  if (violations.length === 0) {
    process.stdout.write(`Verified the feature catalog in ${catalogPath}.\n`);
    return;
  }
  process.stderr.write(
    `The feature catalog is out of date:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
