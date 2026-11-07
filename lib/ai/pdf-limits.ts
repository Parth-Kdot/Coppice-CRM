// The upload rules a browser can check before sending the file (no PDF reading here, so the
// packet upload can import it without pulling the PDF reader into the page). The server checks the
// same rules again (app/(app)/[workspaceId]/facts/actions.ts), then reads the file (lib/ai/pdf.ts).

export const PDF_MAX_BYTES = 3.5 * 1024 * 1024;
export const PDF_MAX_PAGES = 40;

export const PDF_TOO_BIG = "The PDF is over 3.5 MB. Export a smaller copy.";
export const NOT_A_PDF = "Choose a PDF file.";

// What is wrong with a chosen file, or null if it may be sent.
export function pdfFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0 || !/\.pdf$/i.test(file.name)) return NOT_A_PDF;
  if (file.size > PDF_MAX_BYTES) return PDF_TOO_BIG;
  return null;
}
