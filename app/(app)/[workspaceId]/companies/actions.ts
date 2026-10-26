"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure } from "@/lib/actions";
import { requireMembership, requireOwner } from "@/lib/authz";
import * as claims from "@/lib/claims";
import { changeStage } from "@/lib/claims";
import * as companies from "@/lib/companies";
import type { SaveResult } from "@/lib/companies";
import {
  addContactSchema,
  archiveDuplicateSchema,
  companyRefSchema,
  contactRefSchema,
  createCompanySchema,
  duplicatePairSchema,
  logOutreachSchema,
  moveStageSchema,
  sameCompanySchema,
  unarchiveSchema,
  updateCompanySchema,
  updateContactSchema,
  type ActionResult,
} from "@/lib/validation";

// Every action: validate the form, check membership (project rule 1), then call lib/, which runs
// inside withTenant so row-level security backs up the workspace check. Any member may do these,
// except that a company someone else holds can only be moved or archived by them or an owner, and
// only owners can force-release a claim (all enforced in lib/claims.ts).

const companyPath = (workspaceId: string, companyId: string) => `/${workspaceId}/companies/${companyId}`;
const boardPath = (workspaceId: string) => `/${workspaceId}/board`;

// After a change, the company's page, the board and the queue (the workspace home) all show
// fresh data on their next visit.
function refresh(workspaceId: string, companyId: string) {
  revalidatePath(companyPath(workspaceId, companyId));
  revalidatePath(boardPath(workspaceId));
  revalidatePath(`/${workspaceId}`);
}

// The four company boxes, optionally under a prefix ("original." holds what the form loaded).
const companyFields = (form: FormData, prefix = "") => ({
  name: form.get(`${prefix}name`),
  industry: form.get(`${prefix}industry`),
  website: form.get(`${prefix}website`),
  notes: form.get(`${prefix}notes`),
});

const contactFields = (form: FormData) => ({
  name: form.get("name"),
  email: form.get("email"),
  title: form.get("title"),
});

// Saves a new company, or returns the look-alikes to ask about. Once saved, opens its page.
export async function createCompany(_prev: ActionResult<SaveResult> | null, form: FormData): Promise<ActionResult<SaveResult>> {
  const parsed = createCompanySchema.safeParse({
    workspaceId: form.get("workspaceId"),
    separateFrom: form.get("separateFrom"),
    ...companyFields(form),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, separateFrom, ...fields } = parsed.data;

  let result: SaveResult;
  try {
    const { userId } = await requireMembership(workspaceId);
    result = await companies.createCompany({ userId, workspaceId }, fields, separateFrom);
  } catch (e) {
    return failure(e);
  }
  if (result.status !== "saved") return { ok: true, data: result };
  refresh(workspaceId, result.companyId);
  redirect(companyPath(workspaceId, result.companyId));
}

// Saves only the changed fields, or returns look-alikes or a conflict (see updateCompany in lib/).
export async function updateCompany(_prev: ActionResult<SaveResult> | null, form: FormData): Promise<ActionResult<SaveResult>> {
  const parsed = updateCompanySchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    separateFrom: form.get("separateFrom"),
    changes: companyFields(form),
    original: companyFields(form, "original."),
  });
  if (!parsed.success) {
    // The "original" values are hidden fields the page fills in, so a problem there means a
    // stale or tampered form, not a typing mistake.
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.path[0] === "original" ? "Reload the page and try again." : issue.message };
  }
  const { workspaceId, companyId, separateFrom, changes, original } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.updateCompany({ userId, workspaceId }, companyId, { changes, original }, separateFrom);
    if (result.ok && result.data.status === "saved") refresh(workspaceId, companyId);
    return result;
  } catch (e) {
    return failure(e);
  }
}

export async function archiveCompany(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = companyRefSchema.safeParse({ workspaceId: form.get("workspaceId"), companyId: form.get("companyId") });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await companies.archiveCompany(member, companyId);
    if (result.ok) refresh(workspaceId, companyId);
    return result;
  } catch (e) {
    return failure(e);
  }
}

// Brings an archived company back and opens its page. Also used by "Unarchive it instead" when
// someone tries to add a company that was archived. From the board's Archived list
// (stay=board), it stays on the board instead.
export async function unarchiveCompany(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = unarchiveSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    stay: form.get("stay"),
  });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId, stay } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.unarchiveCompany({ userId, workspaceId }, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  if (stay === "board") return { ok: true, data: undefined };
  redirect(companyPath(workspaceId, companyId));
}

// "Same company" while editing: archive the one being edited, keep the other, and open it.
export async function archiveAsDuplicate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = sameCompanySchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    keepId: form.get("keepId"),
  });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId, keepId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await companies.resolveAsDuplicate(member, keepId, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  redirect(companyPath(workspaceId, keepId));
}

// "Possible duplicates" on the board: these two are separate, remembered so they stop being flagged.
export async function keepSeparate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = duplicatePairSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    otherId: form.get("otherId"),
  });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId, otherId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await companies.markSeparate(member, companyId, otherId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(boardPath(workspaceId));
  return { ok: true, data: undefined };
}

// "Possible duplicates" on the board: same company, so archive the one picked and stay on the
// board. Same claim rule as any archive (lib/claims.ts).
export async function archiveDuplicate(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = archiveDuplicateSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    keepId: form.get("keepId"),
    archiveId: form.get("archiveId"),
  });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, keepId, archiveId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await companies.resolveAsDuplicate(member, keepId, archiveId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, archiveId);
  return { ok: true, data: undefined };
}

export async function moveStage(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = moveStageSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    stage: form.get("stage"),
  });
  if (!parsed.success) return { ok: false, error: "Pick a stage." };
  const { workspaceId, companyId, stage } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await changeStage(member, companyId, stage);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  return { ok: true, data: undefined };
}

// ----- Claims and outreach (Milestone 3). All the rules live in lib/claims.ts. -----

export async function claimCompany(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = companyRefSchema.safeParse({ workspaceId: form.get("workspaceId"), companyId: form.get("companyId") });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await claims.claimCompany(member, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  return { ok: true, data: undefined };
}

export async function releaseClaim(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = companyRefSchema.safeParse({ workspaceId: form.get("workspaceId"), companyId: form.get("companyId") });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await claims.releaseClaim(member, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  return { ok: true, data: undefined };
}

// Owners only: checked here (requireOwner) and again inside forceRelease.
export async function forceRelease(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = companyRefSchema.safeParse({ workspaceId: form.get("workspaceId"), companyId: form.get("companyId") });
  if (!parsed.success) return { ok: false, error: "Company not found." };
  const { workspaceId, companyId } = parsed.data;

  try {
    const owner = await requireOwner(workspaceId);
    const result = await claims.forceRelease(owner, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  return { ok: true, data: undefined };
}

export async function logOutreach(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = logOutreachSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    channel: form.get("channel"),
    note: form.get("note"),
    followUpOn: form.get("followUpOn"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, companyId, ...input } = parsed.data;

  try {
    const member = await requireMembership(workspaceId);
    const result = await claims.logOutreach(member, companyId, input);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  return { ok: true, data: undefined };
}

export async function addContact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = addContactSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    ...contactFields(form),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, companyId, ...fields } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.addContact({ userId, workspaceId }, companyId, fields);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(companyPath(workspaceId, companyId));
  return { ok: true, data: undefined };
}

export async function updateContact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = updateContactSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    contactId: form.get("contactId"),
    ...contactFields(form),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { workspaceId, companyId, contactId, ...fields } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.updateContact({ userId, workspaceId }, contactId, fields);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(companyPath(workspaceId, companyId));
  return { ok: true, data: undefined };
}

export async function removeContact(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = contactRefSchema.safeParse({
    workspaceId: form.get("workspaceId"),
    companyId: form.get("companyId"),
    contactId: form.get("contactId"),
  });
  if (!parsed.success) return { ok: false, error: "Contact not found." };
  const { workspaceId, companyId, contactId } = parsed.data;

  try {
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.removeContact({ userId, workspaceId }, contactId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  revalidatePath(companyPath(workspaceId, companyId));
  return { ok: true, data: undefined };
}
