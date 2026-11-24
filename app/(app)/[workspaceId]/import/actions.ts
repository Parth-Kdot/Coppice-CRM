"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/action-failure";
import { requireMembership } from "@/lib/authz";
import * as csv from "@/lib/csv";
import { readCsvFile, readFile } from "@/lib/csv-file";
import { previewImportSchema, runImportSchema, type ActionResult } from "@/lib/validation";

// Both steps send the file itself; the server parses and checks it again every time (lib/csv.ts).
// Any member may import.

export async function previewImport(_prev: ActionResult<csv.ImportPreview> | null, form: FormData): Promise<ActionResult<csv.ImportPreview>> {
  const parsed = previewImportSchema.safeParse({ workspaceId: form.get("workspaceId"), mapping: form.get("mapping") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, mapping } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const read = await readCsvFile(form);
    if (!read.ok) return read;
    return await csv.previewImport({ userId, workspaceId }, read.data.text, mapping, read.data.encoding === "windows-1252" ? "windows-1252" : undefined);
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
