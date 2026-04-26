import { File as NodeFile } from "node:buffer";
import { describe, it, expect, vi } from "vitest";
import { extractText, MAX_FILE_SIZE_BYTES } from "./extract-text";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({
          items: [{ str: "Hello PDF" }],
        }),
      }),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("mammoth/mammoth.browser.js", () => ({
  default: {
    extractRawText: vi.fn().mockResolvedValue({ value: "Hello DOCX" }),
  },
}));

const makeFile = (name: string, type: string, sizeBytes = 100): File =>
  new NodeFile([new Uint8Array(sizeBytes)], name, { type }) as unknown as File;

describe("extractText", () => {
  it("extracts PDF text", async () => {
    const file = makeFile("a.pdf", "application/pdf");
    const result = await extractText(file);
    expect(result).toEqual({ ok: true, text: "Hello PDF", sourceFormat: "pdf" });
  });

  it("extracts DOCX text", async () => {
    const file = makeFile(
      "a.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const result = await extractText(file);
    expect(result).toEqual({ ok: true, text: "Hello DOCX", sourceFormat: "docx" });
  });

  it("rejects unsupported types", async () => {
    const file = makeFile("a.png", "image/png");
    const result = await extractText(file);
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });

  it("rejects files over the size cap", async () => {
    const file = makeFile("a.pdf", "application/pdf", MAX_FILE_SIZE_BYTES + 1);
    const result = await extractText(file);
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
  });
});
