export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type ExtractResult =
  | { ok: true; text: string; sourceFormat: "pdf" | "docx" }
  | { ok: false; error: "UNSUPPORTED_TYPE" | "TOO_LARGE" | "EXTRACTION_FAILED" };

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractText(file: File): Promise<ExtractResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  if (file.type === PDF_MIME || file.name.toLowerCase().endsWith(".pdf")) {
    return extractPdf(file);
  }
  if (file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx")) {
    return extractDocx(file);
  }
  return { ok: false, error: "UNSUPPORTED_TYPE" };
}

async function extractPdf(file: File): Promise<ExtractResult> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Provide worker URL via Next.js ?url import, no-op in test env (mocked).
    try {
      // Worker URL provided by Next bundler via ?url query.
      pdfjs.GlobalWorkerOptions.workerSrc = (
        await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")
      ).default;
    } catch {
      // Worker URL not resolvable outside Next.js bundler context; leave empty.
    }
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.push(content.items.map((it: any) => it.str).join(" "));
    }
    return { ok: true, text: out.join("\n").trim(), sourceFormat: "pdf" };
  } catch {
    return { ok: false, error: "EXTRACTION_FAILED" };
  }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  try {
    // mammoth/mammoth.browser.js is a CommonJS bundle that when dynamically
    // imported has the mammoth API as its default export.
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { ok: true, text: result.value.trim(), sourceFormat: "docx" };
  } catch {
    return { ok: false, error: "EXTRACTION_FAILED" };
  }
}
