// Ambient declarations for module imports without built-in type definitions.

// Ambient declaration for the Next.js / Vite / Turbopack ?url query suffix
// applied to the pdfjs-dist worker module. Resolved at build time to a
// string URL the worker can be loaded from.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}

// Mammoth browser bundle type declarations.
declare module "mammoth/mammoth.browser.js" {
  type ExtractRawTextInput = { arrayBuffer: ArrayBuffer };
  type ExtractRawTextResult = { value: string; messages: unknown[] };
  const mammoth: {
    extractRawText: (input: ExtractRawTextInput) => Promise<ExtractRawTextResult>;
  };
  export default mammoth;
}
