"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failure } from "@/lib/actions";
import { requireMembership } from "@/lib/authz";
import { changeStage } from "@/lib/claims";
import * as companies from "@/lib/companies";
import type { SaveResult } from "@/lib/companies";
import {
  addContactSchema,
  companyRefSchema,
  contactRefSchema,
  createCompanySchema,
  moveStageSchema,
  sameCompanySchema,
  unarchiveSchema,
  updateCompanySchema,
  updateContactSchema,
  type ActionResult,
} from "@/lib/validation";

// Every action: validate the form, check membership (project rule 1), then call lib/, which runs
// inside withTenant so row-level security backs up the workspace check. Any member may do all of
// these; Milestone 3 limits stage moves on a claimed company to its holder or an owner.

const companyPath = (workspaceId: string, companyId: string) => `/${workspaceId}/companies/${companyId}`;
const boardPath = (workspaceId: string) => `/${workspaceId}/board`;

// After a change, both the company's page and the board show fresh data on their next visit.
function refresh(workspaceId: string, companyId: string) {
  revalidatePath(companyPath(workspaceId, companyId));
  revalidatePath(boardPath(workspaceId));
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
  revalidatePath(boardPath(workspaceId));
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
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.archiveCompany({ userId, workspaceId }, companyId);
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
    const { userId } = await requireMembership(workspaceId);
    const result = await companies.resolveAsDuplicate({ userId, workspaceId }, keepId, companyId);
    if (!result.ok) return result;
  } catch (e) {
    return failure(e);
  }
  refresh(workspaceId, companyId);
  redirect(companyPath(workspaceId, keepId));
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
    const { userId } = await requireMembership(workspaceId);
    const result = await changeStage({ userId, workspaceId }, companyId, stage);
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
