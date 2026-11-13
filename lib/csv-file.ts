import { IMPORT_MAX_BYTES } from "@/lib/limits";
import type { ActionResult } from "@/lib/validation";

// The uploaded file as text, or why it can't be used. Shared by the import and Smart import actions
// (kept out of the "use server" files, so it is never an action of its own). The browser runs the
// same checks and decoding before it uploads (components/csv-importer.tsx), so a refusal shows at
// once; the server checks again, because the browser's word counts for nothing.

const CHOOSE_CSV = "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values.";
const TOO_BIG = "The file is over 3 MB. Split it into smaller files.";

// Why a file can't be imported before it is even read (name and size only), or null.
export function fileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "Choose a .csv file.";
  if (!/\.csv$/i.test(file.name)) return CHOOSE_CSV;
  if (file.size > IMPORT_MAX_BYTES) return TOO_BIG;
  return null;
}

export type Decoded = { text: string; encoding: "utf-8" | "utf-16" | "windows-1252" };

// Spreadsheet exports come in three encodings: UTF-8 (Google Sheets, Excel's "CSV UTF-8", with or
// without a byte-order mark), UTF-16 (Excel's "Unicode Text"; always with a byte-order mark) and
// Windows-1252 (Excel's plain "CSV (Comma delimited)" on Windows). UTF-8 is tried strictly first,
// so a file that isn't UTF-8 is never read into U+FFFD replacement characters; it is then read as
// Windows (Western) text, and the review says so.
export function decodeCsvBytes(bytes: Uint8Array): Decoded {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16" };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export async function readCsvFile(form: FormData): Promise<ActionResult<Decoded>> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a .csv file." };
  const problem = fileProblem(file);
  if (problem) return { ok: false, error: problem };
  return { ok: true, data: decodeCsvBytes(new Uint8Array(await file.arrayBuffer())) };
}

export async function readFile(form: FormData): Promise<ActionResult<string>> {
  const read = await readCsvFile(form);
  return read.ok ? { ok: true, data: read.data.text } : read;
}
