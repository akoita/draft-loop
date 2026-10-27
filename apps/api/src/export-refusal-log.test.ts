import { ExportRenderingQaError } from "@draft-loop/application";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { sendError } from "./errors.js";
import { cloudLoggingOptions } from "./logging.js";

describe("a refused export (#1828)", () => {
  it("logs the failed checks and answers the person's message, with no content", async () => {
    const lines: Record<string, unknown>[] = [];
    const server = Fastify({
      logger: cloudLoggingOptions({
        write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
      }),
    });
    server.setErrorHandler(sendError);
    server.get("/export", async () => {
      throw new ExportRenderingQaError("pdf", {
        failedChecks: ["visible-content", "viewer-visible-content"],
        undrawableCharacters: ["U+2212"],
      });
    });
    try {
      const response = await server.inject({ method: "GET", url: "/export" });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: "rejected",
          message:
            "The PDF export failed rendering checks; no file was written. The PDF cannot draw these characters: U+2212.",
        },
      });
      expect(lines).toContainEqual(
        expect.objectContaining({
          severity: "WARNING",
          message: "export refused by rendering checks",
          format: "pdf",
          failedChecks: ["visible-content", "viewer-visible-content"],
          undrawableCharacters: ["U+2212"],
        }),
      );
    } finally {
      await server.close();
    }
  });
});
