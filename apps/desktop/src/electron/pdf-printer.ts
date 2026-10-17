import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PdfPrinter, PrintedTextUnit } from "@draft-loop/rendering";
import { BrowserWindow, session } from "electron";

/*
 * Prints print HTML (#1362) to an A4 PDF with the browser engine Electron ships. The page loads in a
 * hidden, sandboxed window on its own in-memory session that refuses every request except the one
 * local file, so the document can neither reach the network nor navigate away. After the fonts
 * load, the window reports the text of every marked block, which rendering QA compares with the
 * artifact; then Chromium prints with the CSS page size and margins.
 */

const printPartition = "draft-loop-print";
const unitAttribute = "data-dl-unit";

const collectUnitsScript = `(async () => {
  await document.fonts.ready;
  return Array.from(document.querySelectorAll("[${unitAttribute}]"), (element) => ({
    kind: element.getAttribute("${unitAttribute}"),
    text: element.textContent ?? "",
  }));
})()`;

/** The units the page reported, checked for shape; anything unexpected fails the export. */
export function parsePrintedUnits(value: unknown): readonly PrintedTextUnit[] {
  if (!Array.isArray(value)) throw new Error("The print preview did not report its text.");
  return value.map((entry: unknown) => {
    const unit = entry as { readonly kind?: unknown; readonly text?: unknown } | null;
    if (
      unit === null ||
      typeof unit !== "object" ||
      (unit.kind !== "heading" && unit.kind !== "body") ||
      typeof unit.text !== "string"
    ) {
      throw new Error("The print preview reported text in an unexpected shape.");
    }
    return { kind: unit.kind, text: unit.text };
  });
}

let partitionGuarded = false;

function guardedPrintSession(allowedUrl: () => string | undefined): Electron.Session {
  const printSession = session.fromPartition(printPartition);
  if (!partitionGuarded) {
    printSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: details.url !== allowedUrl() });
    });
    printSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    partitionGuarded = true;
  }
  return printSession;
}

let currentUrl: string | undefined;

/** A printer that renders through a hidden Electron window; one print runs at a time. */
export function createElectronPdfPrinter(): PdfPrinter {
  let queue: Promise<unknown> = Promise.resolve();
  const print: PdfPrinter = async (html) => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-print-"));
    const file = join(directory, "cv.html");
    const window = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: {
        session: guardedPrintSession(() => currentUrl),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    try {
      await writeFile(file, html, "utf8");
      currentUrl = pathToFileURL(file).href;
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      await window.loadURL(currentUrl);
      const units = parsePrintedUnits(
        await window.webContents.executeJavaScript(collectUnitsScript, true),
      );
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        displayHeaderFooter: false,
        generateTaggedPDF: true,
        generateDocumentOutline: false,
      });
      return {
        pdf: new Uint8Array(pdf),
        units,
        viewerName: "Chromium (Electron)",
        viewerVersion: process.versions.chrome ?? "unknown",
      };
    } finally {
      currentUrl = undefined;
      window.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  };
  return async (html) => {
    const result = queue.then(
      () => print(html),
      () => print(html),
    );
    queue = result.catch(() => undefined);
    return result;
  };
}
