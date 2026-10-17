import { builtInRenderingTemplates, defaultRenderingTemplateId } from "@draft-loop/rendering";
import { describe, expect, it } from "vitest";

import {
  defaultExportTemplate,
  exportTemplateApplicationKey,
  exportTemplateLabels,
  exportTemplates,
  parseExportTemplate,
  readStoredExportTemplate,
  writeStoredExportTemplate,
} from "./export-template.js";
import { exportReviewAction } from "./review.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("export templates", () => {
  it("offers exactly the rendering package's built-in templates, under their names", () => {
    expect([...exportTemplates].sort()).toEqual(Object.keys(builtInRenderingTemplates).sort());
    expect(defaultExportTemplate).toBe(defaultRenderingTemplateId);
    for (const template of exportTemplates) {
      expect(exportTemplateLabels[template]).toBe(builtInRenderingTemplates[template]?.displayName);
    }
  });

  it("keys the choice by the application's first run, or by the run outside an application", () => {
    const runs = [{ runId: "run-3" }, { runId: "run-2" }, { runId: "run-1" }];
    expect(
      exportTemplateApplicationKey({ workspaceId: "ws", runId: "run-3", applicationRuns: runs }),
    ).toBe("draft-loop.export.template.ws:run-1");
    expect(
      exportTemplateApplicationKey({ workspaceId: "ws", runId: "run-9", applicationRuns: null }),
    ).toBe("draft-loop.export.template.ws:run-9");
  });

  it("remembers a choice per application and falls back to Classic", () => {
    const storage = memoryStorage();
    writeStoredExportTemplate(storage, "app-a", "compact");
    expect(readStoredExportTemplate(storage, "app-a")).toBe("compact");
    expect(readStoredExportTemplate(storage, "app-b")).toBe("classic");
    expect(readStoredExportTemplate(undefined, "app-a")).toBe("classic");
    expect(parseExportTemplate("fancy")).toBe("classic");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredExportTemplate(blocked, "app-a")).toBe("classic");
    expect(() => writeStoredExportTemplate(blocked, "app-a", "compact")).not.toThrow();
  });

  it("sends only the fields that differ from the defaults", () => {
    expect(exportReviewAction("markdown", "classic")).toEqual({ type: "export" });
    expect(exportReviewAction("pdf", "compact")).toEqual({
      type: "export",
      format: "pdf",
      template: "compact",
    });
  });
});
