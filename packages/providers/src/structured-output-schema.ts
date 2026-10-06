import { z } from "zod";
import type { JsonObject, JsonSchema, JsonValue } from "./index.js";

const singleSchemaKeywords = new Set([
  "additionalItems",
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const schemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

/** Return a detached schema copy without the given keywords; property names are never dropped. */
export function withoutSchemaKeywords(value: JsonValue, keywords: ReadonlySet<string>): JsonValue {
  return transformSchema(value, (key) => !keywords.has(key));
}

/**
 * Return a detached schema copy without any `enum` listing more than `maximum` values.
 * The rest of each affected node (for example `type`) is kept; property names are never dropped.
 */
export function withoutOversizedEnums(value: JsonValue, maximum: number): JsonValue {
  return transformSchema(
    value,
    (key, child) => !(key === "enum" && Array.isArray(child) && child.length > maximum),
  );
}

type KeywordFilter = (key: string, child: JsonValue) => boolean;

function transformSchema(value: JsonValue, keep: KeywordFilter): JsonValue {
  const strip = (child: JsonValue): JsonValue => transformSchema(child, keep);
  if (Array.isArray(value)) return value.map((item) => strip(item));
  if (!isRecord(value)) return value as JsonValue;

  const entries = Object.entries(value).flatMap(([key, child]): [string, JsonValue][] => {
    if (!keep(key, child as JsonValue)) return [];
    if (singleSchemaKeywords.has(key)) {
      return [[key, strip(child as JsonValue)]];
    }
    if (schemaArrayKeywords.has(key) && Array.isArray(child)) {
      return [[key, child.map((schema) => strip(schema as JsonValue))]];
    }
    if (schemaMapKeywords.has(key) && isRecord(child)) {
      return [
        [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, schema]) => [name, strip(schema as JsonValue)]),
          ),
        ],
      ];
    }
    if (key === "dependencies" && isRecord(child)) {
      return [
        [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, dependency]) => [
              name,
              Array.isArray(dependency) ? dependency : strip(dependency as JsonValue),
            ]),
          ),
        ],
      ];
    }
    return [[key, child as JsonValue]];
  });
  return Object.fromEntries(entries) as JsonObject;
}

const schemaDefaultKeywords: ReadonlySet<string> = new Set(["default"]);

export type CompiledOutputSchema = ReturnType<typeof z.fromJSONSchema>;

/**
 * Compile a detached validator for a requested JSON output schema.
 *
 * Defaults are annotations for generation, not permission to repair provider output.
 * The detached copy keeps required fields required while the original schema sent over
 * the wire and the returned JSON stay untouched. Throws when the schema is unsupported.
 */
export function compileStructuredOutputSchema(schema: JsonSchema): CompiledOutputSchema {
  return z.fromJSONSchema(
    withoutSchemaKeywords(schema, schemaDefaultKeywords) as Parameters<typeof z.fromJSONSchema>[0],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
