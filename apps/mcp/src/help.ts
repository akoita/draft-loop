import {
  type HelpGuideResponse,
  helpGuideResponseSchema,
  helpGuideSectionSchema,
} from "@draft-loop/schemas/help-guide";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's user guide (#2881): the same text as DraftLoop's Help button, so an agent
 * answers its candidate's "how do I" questions without guessing. Reads only; needs the `journal`
 * scope, which a token holds by default.
 */

export type HelpLanguage = "en" | "fr";

export interface HelpApi {
  read(language: HelpLanguage, query?: string): Promise<HelpGuideResponse>;
}

export function createHelpApi(call: WorkspaceApiCall): HelpApi {
  return {
    read: async (language, query) => {
      const search = new URLSearchParams({ language });
      if (query !== undefined && query.trim() !== "") search.set("q", query.trim());
      return helpGuideResponseSchema.parse(
        await call(`/help?${search.toString()}`, { method: "GET" }),
      );
    },
  };
}

/** The guide as one Markdown page: what the resource returns. */
export function helpMarkdown(guide: HelpGuideResponse): string {
  const title = guide.language === "fr" ? "Guide de DraftLoop" : "DraftLoop user guide";
  const sections = guide.sections.map((section) =>
    [`## ${section.title}`, ...section.paragraphs].join("\n\n"),
  );
  return `${[`# ${title}`, guide.intro, ...sections].join("\n\n")}\n`;
}

export const searchHelpDescription =
  "Search DraftLoop's user guide, the text its Help button shows, to answer the candidate's questions about using DraftLoop: adding evidence, jobs, runs, review and export, Prepare, agents, credits, privacy and errors. Pass a few words; leave query out for the whole guide. Answer from the returned sections and never guess a screen or button that is not in them.";

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

const languageSchema = z.enum(["en", "fr"]);

/** Registers search_help and the guide resources on the server. */
export function registerHelpTools(server: McpServer, api: HelpApi, failure: Failure): void {
  server.registerTool(
    "search_help",
    {
      title: "Search the DraftLoop user guide",
      description: searchHelpDescription,
      inputSchema: z.object({
        query: z.string().trim().max(200).optional().describe("A few words, such as 'export PDF'."),
        language: languageSchema
          .optional()
          .describe("en (default) or fr, the candidate's language."),
      }),
      outputSchema: z.object({
        language: languageSchema,
        query: z.string().nullable(),
        sections: z.array(helpGuideSectionSchema),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, language }) => {
      try {
        const guide = await api.read(language ?? "en", query);
        const structured = {
          language: guide.language,
          query: guide.query,
          sections: guide.sections,
        };
        return {
          structuredContent: structured,
          content: [{ type: "text" as const, text: JSON.stringify(structured) }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  for (const language of ["en", "fr"] as const) {
    server.registerResource(
      `help-guide-${language}`,
      `draftloop://help/guide/${language}`,
      {
        title: language === "fr" ? "Guide de DraftLoop" : "DraftLoop user guide",
        description:
          language === "fr"
            ? "The whole user guide in French, as the Help button shows it."
            : "The whole user guide in English, as the Help button shows it.",
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: helpMarkdown(await api.read(language)),
          },
        ],
      }),
    );
  }
}
