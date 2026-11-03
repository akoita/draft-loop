import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { askWhereToSave } from "./downloads.js";
import { partitionFor } from "./partition.js";

describe("askWhereToSave", () => {
  it("asks with the export's own name in the Downloads folder", () => {
    const setSaveDialogOptions = vi.fn();
    askWhereToSave({ getFilename: () => "cv-v3.docx", setSaveDialogOptions }, "/home/me/Downloads");
    expect(setSaveDialogOptions).toHaveBeenCalledWith({
      title: "Save export",
      defaultPath: join("/home/me/Downloads", "cv-v3.docx"),
      buttonLabel: "Save",
    });
  });

  it("keeps a name with folders in it inside the Downloads folder", () => {
    const setSaveDialogOptions = vi.fn();
    askWhereToSave({ getFilename: () => "../../escape.pdf", setSaveDialogOptions }, "/d");
    expect(setSaveDialogOptions.mock.calls[0]?.[0].defaultPath).toBe(join("/d", "escape.pdf"));
  });
});

describe("partitionFor", () => {
  it("gives each server its own persistent partition", () => {
    const a = partitionFor("https://a.example");
    expect(a).toMatch(/^persist:server-[0-9a-f]{24}$/u);
    expect(partitionFor("https://a.example")).toBe(a);
    expect(partitionFor("https://b.example")).not.toBe(a);
  });
});
