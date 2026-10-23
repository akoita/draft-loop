import {
  type HostedSensitivityRules,
  type SourceSensitivityRulesView,
  sourceSensitivityTiers,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

export interface SensitivityRulesRoutesOptions {
  /** The tenant's knowledge bases' rules, kept beside its knowledge intake. */
  readonly rules: HostedSensitivityRules;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u, "must be a safe identifier");
const knowledgeBaseParams = z.strictObject({
  knowledgeBaseId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});
const ruleParams = knowledgeBaseParams.extend({ ruleId: identifierSchema });

const headingText = z.string().trim().min(1).max(200);

const matchSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("heading-contains"),
      text: headingText.describe("Matches a section whose heading contains this text."),
    }),
    z.strictObject({
      kind: z.literal("heading-path"),
      path: z
        .array(headingText)
        .min(1)
        .max(12)
        .describe("Matches the section under these headings, from the top level down."),
    }),
  ])
  .meta({ id: "SensitivityRuleMatch" });

const tierSchema = z
  .enum(sourceSensitivityTiers)
  .describe(
    "never-share sections never reach a provider; sensitive ones need the workspace's consent.",
  );

const addRuleBody = z.strictObject({
  tier: tierSchema,
  match: matchSchema,
  id: identifierSchema.optional().describe("The rule's id; generated when absent."),
});

const ruleSchema = z
  .object({ id: z.string(), tier: tierSchema, match: matchSchema })
  .meta({ id: "SensitivityRule" });

const rulesViewSchema = z
  .object({
    knowledgeBaseId: z.string(),
    version: z.number().int().describe("The rule list's version; 0 before any rule is saved."),
    createdAt: z.string().nullable(),
    rules: z.array(ruleSchema),
  })
  .meta({ id: "SensitivityRules" });

/** Copies only the schema's fields, so a stored version's extra columns never reach a response. */
const rulesView = (view: SourceSensitivityRulesView) => ({
  knowledgeBaseId: view.knowledgeBaseId,
  version: view.version,
  createdAt: view.createdAt,
  rules: view.rules.map((rule) => ({
    id: rule.id,
    tier: rule.tier,
    match:
      rule.match.kind === "heading-contains"
        ? { kind: rule.match.kind, text: rule.match.text }
        : { kind: rule.match.kind, path: [...rule.match.path] },
  })),
});

/**
 * A knowledge base's sensitivity rules: which heading sections of its Markdown sources are
 * sensitive or never shared. Each change saves a new version of the list, and runs read it.
 */
export function registerSensitivityRulesRoutes(
  parent: FastifyInstance,
  options: SensitivityRulesRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { rules } = options;
  const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

  app.get(
    "/v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules",
    {
      schema: {
        summary: "List a knowledge base's sensitivity rules",
        params: knowledgeBaseParams,
        response: { 200: rulesViewSchema, ...errors },
      },
    },
    async (request) => rulesView(await rules.list(request.params.knowledgeBaseId)),
  );

  app.post(
    "/v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules",
    {
      schema: {
        summary: "Add a sensitivity rule to a knowledge base",
        description:
          "Saves a new version of the rule list; it applies from the next run. A rule with the same id, or the same tier and match, is refused with 422.",
        params: knowledgeBaseParams,
        body: addRuleBody,
        response: { 201: rulesViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { tier, match, id } = request.body;
      const view = await rules.add(request.params.knowledgeBaseId, { tier, match }, id);
      return reply.code(201).send(rulesView(view));
    },
  );

  app.delete(
    "/v1/knowledge-bases/:knowledgeBaseId/sensitivity-rules/:ruleId",
    {
      schema: {
        summary: "Remove a sensitivity rule from a knowledge base",
        description: "Saves a new version of the rule list without the rule.",
        params: ruleParams,
        response: { 200: rulesViewSchema, ...errors },
      },
    },
    async (request) =>
      rulesView(await rules.remove(request.params.knowledgeBaseId, request.params.ruleId)),
  );
}
