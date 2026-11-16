import { createHash } from "node:crypto";
import type { Prisma, VersionField, Via } from "@/generated/prisma/client";
import { purgeExpiredPreviousVersions, type Tenant } from "@/lib/db";
import { when } from "@/lib/dates";
import { PREVIOUS_VERSION_MS, VERSION_LABELS, type PreviousItem } from "@/lib/previous-versions-copy";

// Previous versions: the value a company's name, industry, website or notes, or a contact's name,
// email or title held before its latest change, kept for one hour so a person or their assistant can
// put it back. One slot per (company or contact, field): a change to a field overwrites its slot, a
// field left alone keeps its slot. Written only by lib/companies.ts (updateCompany, editContact),
// inside the edit's own transaction, right after the guarded UPDATE succeeded, so the row lock on the
// company or contact orders every write of a slot. Read only by the company page read in
// lib/companies.ts, for the company page and get_company. Nothing that talks to an AI provider reads
// this table.

export { PREVIOUS_VERSION_MS };

type Tx = Prisma.TransactionClient;

// How many rows one company page reads at most (4 company fields and 3 for each contact).
export const PREVIOUS_VERSIONS_SHOWN = 200;

export const COMPANY_VERSION_FIELDS = { name: "NAME", industry: "INDUSTRY", website: "WEBSITE", notes: "NOTES" } as const satisfies Record<string, VersionField>;
export const CONTACT_VERSION_FIELDS = { name: "NAME", email: "EMAIL", title: "TITLE" } as const satisfies Record<string, VersionField>;
export type CompanyKey = keyof typeof COMPANY_VERSION_FIELDS;
export type ContactKey = keyof typeof CONTACT_VERSION_FIELDS;
const COMPANY_ORDER: VersionField[] = ["NAME", "INDUSTRY", "WEBSITE", "NOTES"];
const CONTACT_ORDER: VersionField[] = ["NAME", "EMAIL", "TITLE"];

export const companyKeyOf = (field: VersionField): CompanyKey | null =>
  (Object.keys(COMPANY_VERSION_FIELDS) as CompanyKey[]).find((k) => COMPANY_VERSION_FIELDS[k] === field) ?? null;
export const contactKeyOf = (field: VersionField): ContactKey | null =>
  (Object.keys(CONTACT_VERSION_FIELDS) as ContactKey[]).find((k) => CONTACT_VERSION_FIELDS[k] === field) ?? null;

// The oldest replacedAt still shown, given the database time (dbNow).
export const liveSince = (now: Date) => new Date(now.getTime() - PREVIOUS_VERSION_MS);

export type VersionTarget = { companyId: string; contactId: string | null };
export type ReplacedValue = { field: VersionField; value: string | null };

// Writes the slot of each field that changed, with the value it held before. Call it inside the
// edit's transaction, after the UPDATE that changed those fields returned count 1: that UPDATE holds
// the company's or contact's row lock until commit, so two edits of one subject write their slots
// one after the other. The old slot is deleted and a new row added (a new id each time, which the
// page's Restore button names). An empty string is stored as null, the way the forms store an empty
// box. The database stamps replacedAt on insert, so it is never passed from here.
export async function savePreviousVersions(tx: Tx, tenant: Tenant, target: VersionTarget, replaced: ReplacedValue[], via: Via): Promise<void> {
  if (replaced.length === 0) return;
  const subjectId = target.contactId ?? target.companyId;
  await tx.previousVersion.deleteMany({ where: { workspaceId: tenant.workspaceId, subjectId, field: { in: replaced.map((r) => r.field) } } });
  await tx.previousVersion.createMany({
    data: replaced.map((r) => ({
      workspaceId: tenant.workspaceId,
      companyId: target.companyId,
      contactId: target.contactId,
      subjectId,
      field: r.field,
      value: r.value || null,
      replacedById: tenant.userId,
      via,
    })),
  });
}

export type PreviousVersionRow = {
  id: string;
  contactId: string | null;
  field: VersionField;
  value: string | null;
  via: Via;
  replacedAt: Date;
  replacedById: string;
  replacedByName: string;
};

// The company's live slots and its contacts', newest first. `now` is the database time; a slot
// replaced an hour ago or more is never returned. The replacer's name only, never their email
// (officers do not see members' emails).
export async function readPreviousVersions(tx: Tx, workspaceId: string, companyId: string, now: Date): Promise<PreviousVersionRow[]> {
  const rows = await tx.previousVersion.findMany({
    where: { workspaceId, companyId, replacedAt: { gt: liveSince(now) } },
    select: { id: true, contactId: true, field: true, value: true, via: true, replacedAt: true, replacedById: true, replacedBy: { select: { name: true } } },
    orderBy: [{ replacedAt: "desc" }, { id: "asc" }],
    take: PREVIOUS_VERSIONS_SHOWN,
  });
  return rows.map(({ replacedBy, ...row }) => ({ ...row, replacedByName: replacedBy.name }));
}

// One live slot of this company, for a restore. Null when it is gone, expired or not this company's.
export function findLiveVersion(tx: Tx, workspaceId: string, companyId: string, versionId: string, now: Date) {
  return tx.previousVersion.findFirst({
    where: { id: versionId, workspaceId, companyId, replacedAt: { gt: liveSince(now) } },
    select: { id: true, contactId: true, field: true, value: true },
  });
}

// The live slot of one field of this company or one of its contacts, whatever its id. Null when
// the field has none. Used to tell "changed again" from "expired" when a restore names an id that is gone.
export function findLiveSlot(tx: Tx, workspaceId: string, companyId: string, subject: { field: VersionField; contactId: string | null }, now: Date) {
  return tx.previousVersion.findFirst({
    where: { workspaceId, companyId, contactId: subject.contactId, field: subject.field, replacedAt: { gt: liveSince(now) } },
    select: { id: true },
  });
}

// A short fingerprint of a field's value, for the page's Restore form: it names the current value
// without sending notes back and forth (and without line-break changes a form could make).
export const valueDigest = (value: string | null) =>
  createHash("sha256").update(value === null ? "empty" : `text:${value}`).digest("hex");

// The lazy cleanup, after an edit or a read of this feature. Never fails the request it follows.
export async function purgeQuietly(): Promise<void> {
  try {
    await purgeExpiredPreviousVersions();
  } catch (error) {
    console.error("Purging previous versions failed", error);
  }
}

// The rows the company page draws: the company's in field order, and each contact's. `mine` is true
// when the viewer made any of the company's own live changes, which opens the page's box.
export function previousItems(
  rows: PreviousVersionRow[],
  current: { company: Record<CompanyKey, string | null>; contacts: { id: string; name: string; email: string | null; title: string | null }[] },
  viewerId: string,
  now: Date,
): { company: PreviousItem[]; contacts: Record<string, PreviousItem[]>; mine: boolean } {
  const item = (row: PreviousVersionRow, currentValue: string | null, restoreName: string, focusAfter: string): PreviousItem => {
    const label = VERSION_LABELS[row.field];
    return {
      versionId: row.id,
      field: row.field,
      contactId: row.contactId,
      label,
      value: row.value,
      long: row.field === "NOTES" && row.value !== null && (row.value.length > 140 || row.value.includes("\n")),
      ageMs: Math.max(0, now.getTime() - row.replacedAt.getTime()),
      exactTime: when(row.replacedAt),
      byName: row.replacedByName,
      byAssistant: row.via === "ASSISTANT",
      mine: row.replacedById === viewerId,
      expected: valueDigest(currentValue),
      restoreLabel: `${restoreName} ${label.toLowerCase()}${row.value === null ? " (empty)" : ""}`,
      focusAfter,
    };
  };
  const byOrder = (order: VersionField[]) => (a: PreviousVersionRow, b: PreviousVersionRow) => order.indexOf(a.field) - order.indexOf(b.field);
  const companyRows = rows.filter((r) => r.contactId === null).sort(byOrder(COMPANY_ORDER));
  const company = companyRows.map((r) => item(r, current.company[companyKeyOf(r.field) as CompanyKey], "Restore the previous", ".lg-company h1"));
  const contacts: Record<string, PreviousItem[]> = {};
  for (const contact of current.contacts) {
    const own = rows.filter((r) => r.contactId === contact.id).sort(byOrder(CONTACT_ORDER));
    if (own.length === 0) continue;
    contacts[contact.id] = own.map((r) => item(r, contact[contactKeyOf(r.field) as ContactKey], `Restore ${contact.name}'s previous`, `#contact-${contact.id} .lg-omenu-btn`));
  }
  return { company, contacts, mine: company.some((i) => i.mine) };
}
