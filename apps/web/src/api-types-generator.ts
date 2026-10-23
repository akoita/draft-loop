import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The API's committed OpenAPI document, the contract the web screen is typed by (ADR 0011, D10). */
export const openApiDocumentPath = fileURLToPath(
  new URL("../../api/openapi.json", import.meta.url),
);
export const apiTypesPath = fileURLToPath(new URL("./api-types.generated.ts", import.meta.url));

interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly format?: string;
  readonly description?: string;
}

interface Parameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly required?: boolean;
  readonly schema: JsonSchema;
}

interface Operation {
  readonly parameters?: readonly Parameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>>;
  };
  readonly responses: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { readonly schema: JsonSchema }>> }>
  >;
}

interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
}

const componentPrefix = "#/components/schemas/";

function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Writes the TypeScript type of the JSON Schema subset the API's Zod schemas produce. Validation
 * keywords such as patterns and lengths are left to the API, which checks every request.
 */
function typeOf(schema: JsonSchema, refs: Set<string>, indent: string): string {
  if (schema.$ref !== undefined) {
    const name = schema.$ref.slice(componentPrefix.length);
    refs.add(name);
    return `ApiSchemas[${JSON.stringify(name)}]`;
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum !== undefined)
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (union !== undefined) return union.map((item) => typeOf(item, refs, indent)).join(" | ");
  if (Array.isArray(schema.type))
    return schema.type.map((type) => typeOf({ ...schema, type }, refs, indent)).join(" | ");
  switch (schema.type) {
    case "string":
      return schema.format === "binary" ? "Blob" : "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = typeOf(schema.items ?? {}, refs, indent);
      return `readonly (${item})[]`;
    }
    case "object": {
      const properties = Object.entries(schema.properties ?? {});
      if (properties.length === 0) return "Record<string, never>";
      const inner = `${indent}  `;
      const required = new Set(schema.required ?? []);
      const lines = properties.map(
        ([key, value]) =>
          `${inner}readonly ${quoteKey(key)}${required.has(key) ? "" : "?"}: ${typeOf(value, refs, inner)};`,
      );
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
    default:
      // A schema with no type is the download route's document bytes.
      return "Blob";
  }
}

function parametersType(
  parameters: readonly Parameter[],
  location: Parameter["in"],
  refs: Set<string>,
): string | undefined {
  const selected = parameters.filter((parameter) => parameter.in === location);
  if (selected.length === 0) return undefined;
  const lines = selected.map(
    (parameter) =>
      `      readonly ${quoteKey(parameter.name)}${parameter.required === true ? "" : "?"}: ${typeOf(parameter.schema, refs, "      ")};`,
  );
  return `{\n${lines.join("\n")}\n    }`;
}

function operationType(operation: Operation, refs: Set<string>): string {
  const parameters = operation.parameters ?? [];
  const members: string[] = [];
  for (const location of ["path", "query", "header"] as const) {
    const type = parametersType(parameters, location, refs);
    if (type === undefined) continue;
    const optional = parameters.every(
      (parameter) => parameter.in !== location || parameter.required !== true,
    );
    members.push(`    readonly ${location}${optional ? "?" : ""}: ${type};`);
  }
  const body = operation.requestBody;
  if (body !== undefined) {
    const mediaTypes = Object.keys(body.content);
    if (mediaTypes.length === 1 && mediaTypes[0] === "application/json") {
      const schema = body.content["application/json"]?.schema ?? {};
      members.push(`    readonly body: ${typeOf(schema, refs, "    ")};`);
    } else {
      members.push("    readonly body: Blob;");
      members.push(
        `    readonly contentType: ${mediaTypes.map((type) => JSON.stringify(type)).join(" | ")};`,
      );
    }
  }
  const success = Object.keys(operation.responses)
    .filter((status) => status.startsWith("2"))
    .sort()
    .map((status) => operation.responses[status]?.content?.["application/json"]?.schema)
    .filter((schema): schema is JsonSchema => schema !== undefined);
  const response =
    success.length === 0
      ? "void"
      : [...new Set(success.map((schema) => typeOf(schema, refs, "    ")))].join(" | ");
  members.push(`    readonly response: ${response};`);
  return `{\n${members.join("\n")}\n  }`;
}

/** Generates `api-types.generated.ts` from the API's OpenAPI document. */
export async function generateApiTypes(): Promise<string> {
  const document = JSON.parse(await readFile(openApiDocumentPath, "utf8")) as OpenApiDocument;
  // Every refusal has the one error shape, which the operations' success types never name.
  const refs = new Set<string>(["ApiError"]);
  const operations: string[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const key = `${method.toUpperCase()} ${path}`;
      operations.push(`  ${JSON.stringify(key)}: ${operationType(operation, refs)};`);
    }
  }
  const emitted = new Set<string>();
  const schemas: string[] = [];
  // Components refer to each other, so emit until no new reference appears.
  while ([...refs].some((name) => !emitted.has(name))) {
    for (const name of [...refs].sort()) {
      if (emitted.has(name)) continue;
      emitted.add(name);
      const schema = document.components.schemas[name];
      if (schema === undefined) throw new Error(`The OpenAPI document has no schema ${name}.`);
      schemas.push(`  ${JSON.stringify(name)}: ${typeOf(schema, refs, "  ")};`);
    }
  }
  schemas.sort();
  return [
    "// Generated from apps/api/openapi.json by `pnpm --filter @draft-loop/web api-types`. Do not edit.",
    "",
    "export interface ApiSchemas {",
    ...schemas,
    "}",
    "",
    "export interface ApiOperations {",
    ...operations,
    "}",
    "",
  ].join("\n");
}
