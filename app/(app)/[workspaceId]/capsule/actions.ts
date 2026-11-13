"use server";

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/action-failure";
import { requireMembership, requireOwner } from "@/lib/authz";
import * as capsule from "@/lib/capsule";
import {
  askArchiveSchema,
  cardRefSchema,
  departingSchema,
  fillBlankDatesSchema,
  handoffChunkSchema,
  handoffRefSchema,
  hideCardSchema,
  recontactDatesSchema,
  startHandoffSchema,
  workspaceIdSchema,
  type ActionResult,
} from "@/lib/validation";

// The Time Capsule's server calls (lib/capsule/). Every step of the handoff, building it, reviewing
// it and publishing it, is an owner's: requireOwner first, then the input is checked with its Zod
// schema, then the work runs in lib/capsule (which checks the role again and runs in withTenant).
// Asking the archive is for every member. Each returns { ok, data } or { ok, error }; the chunk
// reader also says whether the AI's rate limit was hit, like Smart import's chunks.
//
//   setDeparting             tick or untick a member as leaving (2a)
//   releaseDepartingClaims   give back every company the departing members hold (2a)
//   startHandoff             start, or pick up, the handoff for a board year (2b)
//   readHandoffChunk         read the next four companies' cards, one chunk per call (2b)
//   buildCodeCards           cards made by code alone for every company still without one (2b)
//   setCardHidden            hide or show a bullet, or a whole card (2c)
//   approveCard, approveRest approve one card, or every card not hidden (2c)
//   saveRecontactDates       the owner's dates for approved cards (2e)
//   fillBlankDates           set every blank date to one date (2e)
//   publishHandoff, unpublishHandoff (2f)
//   askArchive               a question answered from past notes, for every member (3)
//
// Applying the calendar to companies (setFollowUp) and reopening a Committed company are separate
// owner clicks that the next stage adds.

const page = (workspaceId: string) => revalidatePath(`/${workspaceId}/capsule`);
const first = (parsed: { error: { issues: { message: string }[] } }) => parsed.error.issues[0].message;

export async function setDeparting(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = departingSchema.safeParse({ workspaceId: form.get("workspaceId"), userId: form.get("userId"), departing: form.get("departing") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, userId, departing } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.setDeparting(owner, userId, departing);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "setDeparting");
  }
}

export async function releaseDepartingClaims(_prev: ActionResult<capsule.ReleasedClaims> | null, form: FormData): Promise<ActionResult<capsule.ReleasedClaims>> {
  const parsed = workspaceIdSchema.safeParse(form.get("workspaceId"));
  if (!parsed.success) return { ok: false, error: first(parsed) };
  try {
    const owner = await requireOwner(parsed.data);
    const result = await capsule.releaseDepartingClaims(owner);
    if (result.ok) {
      page(parsed.data);
      revalidatePath(`/${parsed.data}/board`);
    }
    return result;
  } catch (e) {
    return failure(e, "releaseDepartingClaims");
  }
}

export async function startHandoff(_prev: ActionResult<capsule.ReportStart> | null, form: FormData): Promise<ActionResult<capsule.ReportStart>> {
  const parsed = startHandoffSchema.safeParse({ workspaceId: form.get("workspaceId"), boardYearStart: form.get("boardYearStart") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, boardYearStart } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.startReport(owner, boardYearStart);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "startHandoff");
  }
}

// The page does not refresh after a chunk: it keeps its own progress, like Smart import, and
// refreshes once the reading is over.
export async function readHandoffChunk(_prev: capsule.ChunkResult | null, form: FormData): Promise<capsule.ChunkResult> {
  const parsed = handoffChunkSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId"), index: form.get("index") });
  if (!parsed.success) return { ok: false, error: first(parsed), rateLimited: false };
  const { workspaceId, reportId, index } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    return await capsule.readCardChunk(owner, reportId, index);
  } catch (e) {
    return { ...failure(e, "readHandoffChunk"), rateLimited: false };
  }
}

export async function buildCodeCards(_prev: ActionResult<{ created: number }> | null, form: FormData): Promise<ActionResult<{ created: number }>> {
  const parsed = handoffRefSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.buildCodeCards(owner, reportId);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "buildCodeCards");
  }
}

// bulletIndex empty: the whole card. hidden "1" hides, "0" shows it again.
export async function setCardHidden(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = hideCardSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    cardId: form.get("cardId"),
    bulletIndex: form.get("bulletIndex"),
    hidden: form.get("hidden"),
  });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, cardId, bulletIndex, hidden } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.setHidden(owner, cardId, bulletIndex, hidden);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "setCardHidden");
  }
}

export async function approveCard(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = cardRefSchema.safeParse({ workspaceId: form.get("workspaceId"), cardId: form.get("cardId") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, cardId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.approveCard(owner, cardId);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "approveCard");
  }
}

export async function approveRest(_prev: ActionResult<{ approved: number }> | null, form: FormData): Promise<ActionResult<{ approved: number }>> {
  const parsed = handoffRefSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.approveRest(owner, reportId);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "approveRest");
  }
}

export async function saveRecontactDates(_prev: ActionResult<capsule.SavedDates> | null, form: FormData): Promise<ActionResult<capsule.SavedDates>> {
  const parsed = recontactDatesSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId"), dates: form.get("dates") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId, dates } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.saveRecontactDates(owner, reportId, dates);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "saveRecontactDates");
  }
}

export async function fillBlankDates(_prev: ActionResult<{ set: number }> | null, form: FormData): Promise<ActionResult<{ set: number }>> {
  const parsed = fillBlankDatesSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId"), date: form.get("date") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId, date } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.fillBlankDates(owner, reportId, date);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "fillBlankDates");
  }
}

export async function publishHandoff(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = handoffRefSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.publishReport(owner, reportId);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "publishHandoff");
  }
}

export async function unpublishHandoff(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = handoffRefSchema.safeParse({ workspaceId: form.get("workspaceId"), reportId: form.get("reportId") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, reportId } = parsed.data;
  try {
    const owner = await requireOwner(workspaceId);
    const result = await capsule.unpublishReport(owner, reportId);
    if (result.ok) page(workspaceId);
    return result;
  } catch (e) {
    return failure(e, "unpublishHandoff");
  }
}

// Ask what past boards wrote. Any member, with AI on. Nothing is stored, so nothing is revalidated.
export async function askArchive(_prev: ActionResult<capsule.ArchiveAnswer> | null, form: FormData): Promise<ActionResult<capsule.ArchiveAnswer>> {
  const parsed = askArchiveSchema.safeParse({ workspaceId: form.get("workspaceId"), question: form.get("question") });
  if (!parsed.success) return { ok: false, error: first(parsed) };
  const { workspaceId, question } = parsed.data;
  try {
    const member = await requireMembership(workspaceId);
    return await capsule.askArchive(member, question);
  } catch (e) {
    return failure(e, "askArchive");
  }
}
