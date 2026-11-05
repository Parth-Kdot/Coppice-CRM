"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import type { ImportResult } from "@/lib/csv";
import * as smart from "@/lib/smart-import";
import { smartChunkSchema, smartImportSchema, smartStartSchema, smartSuggestSchema, type ActionResult } from "@/lib/validation";
import { readFile } from "./read-file";

// Smart import (lib/smart-import/): the same file is sent with every step and parsed again on
// the server, like the normal import. Any member may use it while AI is on for the workspace; the
// server refuses every step when it's off.

export async function suggestColumns(_prev: ActionResult<smart.ColumnSuggestion> | null, form: FormData): Promise<ActionResult<smart.ColumnSuggestion>> {
  const parsed = smartSuggestSchema.safeParse({ workspaceId: form.get("workspaceId") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return text;
    return await smart.suggestColumns({ userId, workspaceId }, text.data);
  } catch (e) {
    return failure(e);
  }
}

export async function startSmartRead(_prev: ActionResult<smart.SmartStart> | null, form: FormData): Promise<ActionResult<smart.SmartStart>> {
  const parsed = smartStartSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    mapping: form.get("mapping"),
    freeText: form.get("freeText"),
    cycleStart: form.get("cycleStart"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, ...choices } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return text;
    return await smart.startSmartRead({ userId, workspaceId }, text.data, choices);
  } catch (e) {
    return failure(e);
  }
}

export async function readSmartChunk(_prev: smart.SmartChunkResult | null, form: FormData): Promise<smart.SmartChunkResult> {
  const parsed = smartChunkSchema.safeParse({ workspaceId: form.get("workspaceId"), sessionId: form.get("sessionId"), index: form.get("index") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, rateLimited: false };
  const { workspaceId, sessionId, index } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return { ...text, rateLimited: false };
    return await smart.readSmartChunk({ userId, workspaceId }, text.data, sessionId, index);
  } catch (e) {
    return { ...failure(e), rateLimited: false };
  }
}

export async function runSmartImport(_prev: ActionResult<ImportResult> | null, form: FormData): Promise<ActionResult<ImportResult>> {
  const parsed = smartImportSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    mapping: form.get("mapping"),
    skip: form.get("skip"),
    seen: form.get("seen"),
    sessionId: form.get("sessionId"),
    decisions: form.get("decisions"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, ...choices } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const text = await readFile(form);
    if (!text.ok) return text;
    const result = await smart.runSmartImport({ userId, workspaceId }, text.data, choices);
    if (result.ok) {
      revalidatePath(`/${workspaceId}`);
      revalidatePath(`/${workspaceId}/board`);
    }
    return result;
  } catch (e) {
    return failure(e);
  }
}
