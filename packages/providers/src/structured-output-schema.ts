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

function withoutSchemaDefaults(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => withoutSchemaDefaults(item));
  if (!isRecord(value)) return value as JsonValue;

  const entries = Object.entries(value).flatMap(([key, child]): [string, JsonValue][] => {
    if (key === "default") return [];
    if (singleSchemaKeywords.has(key)) {
      return [[key, withoutSchemaDefaults(child as JsonValue)]];
    }
    if (schemaArrayKeywords.has(key) && Array.isArray(child)) {
      return [[key, child.map((schema) => withoutSchemaDefaults(schema as JsonValue))]];
    }
    if (schemaMapKeywords.has(key) && isRecord(child)) {
      return [
        [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, schema]) => [
              name,
              withoutSchemaDefaults(schema as JsonValue),
            ]),
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
              Array.isArray(dependency)
                ? dependency
                : withoutSchemaDefaults(dependency as JsonValue),
            ]),
          ),
        ],
      ];
    }
    return [[key, child as JsonValue]];
  });
  return Object.fromEntries(entries) as JsonObject;
}

export type CompiledOutputSchema = ReturnType<typeof z.fromJSONSchema>;

/**
 * Compile a detached validator for a requested JSON output schema.
 *
 * Defaults are annotations for generation, not permission to repair provider output.
 * The detached copy keeps required fields required while the original schema sent over
 * the wire and the returned JSON stay untouched. Throws when the schema is unsupported.
 */
export function compileStructuredOutputSchema(schema: JsonSchema): CompiledOutputSchema {
  return z.fromJSONSchema(withoutSchemaDefaults(schema) as Parameters<typeof z.fromJSONSchema>[0]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
