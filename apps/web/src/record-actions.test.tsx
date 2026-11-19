import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeleteRecordPanel, DownloadPanel } from "./record-actions.js";
import { isDeleteConfirmed } from "./record-actions-model.js";

const download = { busy: false, messages: [], onExport: () => {} };
const remove = { busy: false, messages: [], onDelete: () => {} };

describe("record export and deletion", () => {
  it("offers the download with what it holds, and no delete", () => {
    const html = renderToStaticMarkup(<DownloadPanel {...download} />);

    expect(html).toContain('<button type="button">Download everything</button>');
    expect(html).toContain("The download holds your documents");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain('role="alert"');
  });

  it("shows why the download failed and disables it while busy", () => {
    const html = renderToStaticMarkup(
      <DownloadPanel {...download} busy={true} messages={["The service is unreachable."]} />,
    );

    expect(html).toContain('<button type="button" disabled="">Download everything</button>');
    expect(html).toContain('role="alert">The service is unreachable.</p>');
  });

  it("shows one line and keeps the warning and typed confirm in a dialog", () => {
    const html = renderToStaticMarkup(<DeleteRecordPanel {...remove} />);
    const [line = "", dialog = ""] = html.split("<dialog");

    expect(line).toContain(
      '<button type="button" class="danger-link">Delete all documents and applications…</button>',
    );
    expect(line).not.toContain("It cannot be undone.");
    expect(dialog).toContain("It cannot be undone.");
    expect(dialog).toContain("The account stays");
    expect(dialog).toContain('<label for="delete-record-confirm">Type DELETE to confirm</label>');
    expect(dialog).toContain(">Cancel</button>");
  });

  it("keeps the final delete disabled until the confirm word is typed", () => {
    const html = renderToStaticMarkup(<DeleteRecordPanel {...remove} />);

    expect(html).toContain(
      '<button type="submit" class="danger" disabled="">Delete all documents and applications</button>',
    );
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("DELET")).toBe(false);
    expect(isDeleteConfirmed(" delete ")).toBe(true);
  });

  it("shows a refused delete in its dialog", () => {
    const html = renderToStaticMarkup(
      <DeleteRecordPanel {...remove} messages={["Type DELETE to confirm."]} />,
    );
    const [line = "", dialog = ""] = html.split("<dialog");

    expect(line).not.toContain('role="alert"');
    expect(dialog).toContain('role="alert">Type DELETE to confirm.</p>');
  });
});
