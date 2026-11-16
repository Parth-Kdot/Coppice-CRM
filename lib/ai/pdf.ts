import { extractText, getDocumentProxy } from "unpdf";
import { PDF_MAX_BYTES, PDF_MAX_PAGES } from "@/lib/ai/pdf-limits";
import type { ActionResult } from "@/lib/validation";

// Reads the text of an uploaded PDF page by page (unpdf: PDF.js with no native parts or workers).
// The text is what the AI is shown, and what its quotes are checked against later.

export { PDF_MAX_BYTES, PDF_MAX_PAGES };
const READ_TIMEOUT_MS = 20_000;

export async function readPdfPages(bytes: Uint8Array): Promise<ActionResult<string[]>> {
  try {
    const read = (async () => {
      // PDF.js takes over the buffer it's given, so it gets a copy.
      const pdf = await getDocumentProxy(bytes.slice());
      try {
        if (pdf.numPages > PDF_MAX_PAGES) return { tooLong: pdf.numPages };
        return { pages: (await extractText(pdf)).text };
      } finally {
        await pdf.loadingTask.destroy();
      }
    })();
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), READ_TIMEOUT_MS).unref());
    const result = await Promise.race([read, timeout]);
    if (result === "timeout") return { ok: false, error: "That PDF took too long to read. Try a smaller file." };
    if ("tooLong" in result) return { ok: false, error: `That PDF has ${result.tooLong} pages; the limit is ${PDF_MAX_PAGES}.` };
    // Scans have no text layer. A photo cover page is fine; mostly-image PDFs are not.
    const withText = result.pages.filter((page) => page.trim().length >= 20).length;
    if (withText === 0 || withText < result.pages.length / 2) {
      return { ok: false, error: "This PDF has little or no text to read. Export it as a text PDF (not a scan), or run OCR first." };
    }
    return { ok: true, data: result.pages };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") return { ok: false, error: "That PDF is password-protected. Upload a copy without a password." };
    return { ok: false, error: "That file couldn't be read as a PDF." };
  }
}
