import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "@babel/core";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(sourceDirectory, "../../..");
const screenDirectories = [sourceDirectory, join(repositoryRoot, "apps/web/src")];

/** Attributes a person reads or hears: these go through the catalog like visible text. */
const textAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);
/** Elements whose text is code or sample input, never translated. */
const verbatimElements = new Set(["code", "kbd", "pre", "samp"]);

interface Node {
  readonly type: string;
  readonly [key: string]: unknown;
}

function screenFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : screenFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

function children(node: Node): Node[] {
  return Object.values(node).flatMap((value) => {
    if (Array.isArray(value)) return value.filter((item): item is Node => item?.type !== undefined);
    return (value as Node | null)?.type === undefined ? [] : [value as Node];
  });
}

function elementName(node: Node): string | undefined {
  const opening = node.openingElement as Node | undefined;
  const name = opening?.name as Node | undefined;
  return name?.type === "JSXIdentifier" ? (name.name as string) : undefined;
}

/** Visible text and text attributes written as literals instead of through `t`. */
function unwrappedText(source: string): string[] {
  const ast = parseSync(source, {
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
  }) as unknown as Node;
  const found: string[] = [];
  const visit = (node: Node, verbatim: boolean) => {
    if (node.type === "JSXText" && !verbatim && /\p{L}/u.test(node.value as string)) {
      found.push((node.value as string).trim());
    }
    if (node.type === "JSXAttribute") {
      const name = node.name as Node;
      const value = node.value as Node | null;
      if (
        name.type === "JSXIdentifier" &&
        textAttributes.has(name.name as string) &&
        value?.type === "StringLiteral" &&
        /\p{L}/u.test(value.value as string)
      ) {
        found.push(`${name.name as string}="${value.value as string}"`);
      }
    }
    const inner =
      verbatim || (node.type === "JSXElement" && verbatimElements.has(elementName(node) ?? ""));
    for (const child of children(node)) visit(child, inner);
  };
  visit(ast, false);
  return found;
}

describe("screen strings", () => {
  it("finds literal JSX text and text attributes", () => {
    expect(
      unwrappedText('const a = <p title="Hi there">Hello <code>pnpm test</code>{t`Done`} · </p>;'),
    ).toEqual(['title="Hi there"', "Hello"]);
  });

  it("writes every visible screen string through the catalog (ADR 0012)", () => {
    const offenders = screenDirectories
      .flatMap(screenFiles)
      .flatMap((file) =>
        unwrappedText(readFileSync(file, "utf8")).map(
          (text) => `${relative(repositoryRoot, file)}: ${text}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
