import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

export type AnthropicOutputSchema = Pick<
  ReturnType<typeof jsonSchemaOutputFormat>,
  "type" | "schema"
>;

/** Apply Anthropic's SDK schema compatibility transform and drop its local parser. */
export function normalizeAnthropicOutputSchema(
  schema: Readonly<Record<string, unknown>>,
): AnthropicOutputSchema {
  if (schema.type !== "object") {
    throw new Error("Anthropic structured output requires an object schema.");
  }

  const format = jsonSchemaOutputFormat(schema as Parameters<typeof jsonSchemaOutputFormat>[0]);
  return { type: format.type, schema: format.schema };
}
