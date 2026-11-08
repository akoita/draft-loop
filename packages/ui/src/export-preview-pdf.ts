/**
 * Draws a PDF's pages into a container, one canvas per page, with pdf.js (#2498). pdf.js is
 * loaded on first use, so the review screen only pays for it when the person opens a preview, and
 * its worker comes from this origin: the web's content policy allows no other script source.
 */

/** Whether the caller still wants the pages, checked between pages. */
export interface PdfRenderSignal {
  readonly cancelled: boolean;
}

/** Draws the PDF into `container` and resolves with its page count. */
export type RenderPdfPages = (
  bytes: Uint8Array,
  container: HTMLElement,
  signal: PdfRenderSignal,
  pageLabel: (page: number, pageCount: number) => string,
) => Promise<number>;

/** The widest a page is drawn, in CSS pixels; a wide dialog shows pages side by side. */
const maximumPageWidth = 640;

let worker: Worker | undefined;

export const renderPdfPages: RenderPdfPages = async (bytes, container, signal, pageLabel) => {
  const pdfjs = await import("pdfjs-dist");
  if (worker === undefined) {
    worker = new Worker(new URL("./export-preview-pdf-worker.ts", import.meta.url), {
      type: "module",
    });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
  }
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const loading = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await loading.promise;
    const pageCount = document.numPages;
    const available = Math.max(container.clientWidth - 32, 240);
    const ratio = globalThis.devicePixelRatio ?? 1;
    const figures: HTMLElement[] = [];
    for (let number = 1; number <= pageCount; number += 1) {
      if (signal.cancelled) return pageCount;
      const page = await document.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const cssWidth = Math.min(maximumPageWidth, available);
      const viewport = page.getViewport({ scale: (cssWidth / natural.width) * ratio });
      const canvas = container.ownerDocument.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", pageLabel(number, pageCount));
      await page.render({ canvas, viewport }).promise;
      const figure = container.ownerDocument.createElement("figure");
      figure.className = "export-preview-page";
      const caption = container.ownerDocument.createElement("figcaption");
      caption.textContent = pageLabel(number, pageCount);
      figure.append(canvas, caption);
      figures.push(figure);
    }
    if (!signal.cancelled) container.replaceChildren(...figures);
    return pageCount;
  } finally {
    await loading.destroy();
  }
};
