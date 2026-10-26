"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import * as csv from "@/lib/csv";
import { IMPORT_MAX_BYTES, previewImportSchema, runImportSchema, type ActionResult } from "@/lib/validation";

// Both steps send the file itself; the server parses and checks it again every time (lib/csv.ts).
// Any member may import.

// The uploaded file as text, or why it can't be used.
async function readFile(form: FormData): Promise<ActionResult<string>> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a .csv file." };
  if (!/\.csv$/i.test(file.name)) return { ok: false, error: "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: "The file is over 3 MB. Split it into smaller files." };
  return { ok: true, data: await file.text() };
}

export async function previewImport(_prev: ActionResult<csv.ImportPreview> | null, form: FormData): Promise<ActionResult<csv.ImportPreview>> {
  const parsed = previewImportSchema.safeParse({ workspaceId: form.get("workspaceId"), mapping: form.get("mapping") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, mapping } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return text;
    return await csv.previewImport({ userId, workspaceId }, text.data, mapping);
  } catch (e) {
    return failure(e);
  }
}

export async function runImport(_prev: ActionResult<csv.ImportResult> | null, form: FormData): Promise<ActionResult<csv.ImportResult>> {
  const parsed = runImportSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    mapping: form.get("mapping"),
    skip: form.get("skip"),
    seen: form.get("seen"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, mapping, skip, seen } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return text;
    const result = await csv.runImport({ userId, workspaceId }, text.data, mapping, skip, seen);
    if (result.ok) {
      revalidatePath(`/${workspaceId}`);
      revalidatePath(`/${workspaceId}/board`);
    }
    return result;
  } catch (e) {
    return failure(e);
  }
}
