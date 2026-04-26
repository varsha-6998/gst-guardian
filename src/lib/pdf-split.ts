// Split a PDF File into one PNG Blob per page using pdfjs-dist (browser).
// Used so the upload pipeline can treat each page as a separate invoice.
import * as pdfjs from "pdfjs-dist";
// Vite-friendly worker import
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfPage {
  pageNumber: number;
  totalPages: number;
  blob: Blob;
  fileName: string; // e.g. "invoice.pdf-p1.png"
}

export async function splitPdfToImages(file: File, scale = 2): Promise<PdfPage[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: PdfPage[] = [];
  const baseName = file.name.replace(/\.pdf$/i, "");
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png", 0.92),
    );
    pages.push({
      pageNumber: i,
      totalPages: pdf.numPages,
      blob,
      fileName: `${baseName}-p${i}.png`,
    });
  }
  return pages;
}
