import { IMPORT_MAX_BYTES, type ActionResult } from "@/lib/validation";

// The uploaded file as text, or why it can't be used. Shared by the import and Smart import actions
// (kept out of the "use server" files, so it is never an action of its own).
export async function readFile(form: FormData): Promise<ActionResult<string>> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a .csv file." };
  if (!/\.csv$/i.test(file.name)) return { ok: false, error: "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: "The file is over 3 MB. Split it into smaller files." };
  return { ok: true, data: await file.text() };
}
