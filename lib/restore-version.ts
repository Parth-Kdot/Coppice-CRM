import type { VersionField, Via } from "@/generated/prisma/client";
import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { editContact, sameText, updateCompany, type ContactFields, type DuplicateMatch } from "@/lib/companies";
import { withTenant } from "@/lib/db";
import { COMPANY_ARCHIVED, notFound } from "@/lib/messages";
import { companyKeyOf, contactKeyOf, findLiveSlot, findLiveVersion, valueDigest } from "@/lib/previous-versions";
import { VERSION_CHANGED, VERSION_GONE, VERSION_SAME, VERSION_LABELS } from "@/lib/previous-versions-copy";
import { companyFieldsSchema, contactFieldsSchema, type ActionResult } from "@/lib/validation";

// Putting a previous version back (the company page's Restore and the restore_previous_version tool).
// A restore is an edit: anyone who may edit the field may restore it, under the same rules, and the
// value it replaces becomes the field's new previous version, so a restore can be undone the same way.
// It reads the slot and the current value in one short transaction, checks what the caller expected,
// then makes the change through the normal edit function (updateCompany or editContact), which runs
// every rule a normal edit runs. It never writes the field or the table itself.

// What the caller saw as the field's value now: the page sends a digest, an assistant the text.
export type RestoreExpect = { digest: string } | { value: string | null };

// Which field the caller meant, when it knows (the page's Restore form and the tool's field and
// contactId arguments). Every change to a field gives it a new slot id, so a page that loaded before
// that change names an id that is gone. With the subject, "gone" can tell that case from an hour that
// ran out: a live slot of the same field means the field was changed again.
export type RestoreSubject = { field: VersionField; contactId: string | null };

export type RestoreOutcome =
  | { status: "restored"; field: VersionField; contactId: string | null }
  // The previous version already equals the value now: nothing to do.
  | { status: "unchanged" }
  // Expired, overwritten, deleted with its contact, or not this company's.
  | { status: "gone" }
  // The field changed after the caller read it: nothing was restored.
  | { status: "changed" }
  // Restoring a name or website would make the company look like others: nothing was restored.
  | { status: "possible-duplicates"; matches: DuplicateMatch[]; total: number };

export async function restoreVersion(
  member: Membership,
  input: { companyId: string; versionId: string; expect: RestoreExpect; separateFrom?: string[]; subject?: RestoreSubject },
  via: Via,
): Promise<ActionResult<RestoreOutcome>> {
  const now = await dbNow();
  const { version, company, contact, sameField } = await withTenant(member, async (tx) => {
    const version = await findLiveVersion(tx, member.workspaceId, input.companyId, input.versionId, now);
    const sameField = !version && input.subject ? await findLiveSlot(tx, member.workspaceId, input.companyId, input.subject, now) : null;
    const company = await tx.company.findFirst({
      where: { id: input.companyId, workspaceId: member.workspaceId },
      select: { name: true, industry: true, website: true, notes: true, archivedAt: true },
    });
    const contact = version?.contactId
      ? await tx.contact.findFirst({ where: { id: version.contactId, companyId: input.companyId, workspaceId: member.workspaceId }, select: { name: true, email: true, title: true } })
      : null;
    return { version, company, contact, sameField };
  });
  if (!company) return notFound("Company");
  // The app has no edit form on an archived company and the tools refuse one, so neither restores.
  if (company.archivedAt) return { ok: false, error: COMPANY_ARCHIVED };
  // The slot the page named is gone, but the same field has a newer one: it was changed again.
  if (!version && sameField) return { ok: true, data: { status: "changed" } };
  if (!version || (version.contactId !== null && !contact)) return { ok: true, data: { status: "gone" } };

  const saw = (current: string | null) =>
    "digest" in input.expect ? valueDigest(current) === input.expect.digest : (input.expect.value || null) === (current || null);
  const label = VERSION_LABELS[version.field].toLowerCase();

  if (version.contactId !== null && contact) {
    const key = contactKeyOf(version.field);
    if (!key) return { ok: true, data: { status: "gone" } };
    const current = contact[key];
    if (!saw(current)) return { ok: true, data: { status: "changed" } };
    if ((version.value ?? null) === (current ?? null)) return { ok: true, data: { status: "unchanged" } };
    // The contact form's own rule for this field (a valid email, the length caps).
    const parsed = contactFieldsSchema.shape[key].safeParse(version.value);
    if (!parsed.success) return { ok: false, error: `That previous ${label} can't be restored. ${parsed.error.issues[0].message}` };
    // Only this field is written, so a rename or another change made since is left alone.
    const fields: Partial<ContactFields> = { [key]: parsed.data };
    const saved = await editContact(member, version.contactId, fields, { via, expected: { [key]: current } });
    if (!saved.ok) return saved;
    if (saved.data.status === "changed") return { ok: true, data: { status: "changed" } };
    if (saved.data.status === "unchanged") return { ok: true, data: { status: "unchanged" } };
    return { ok: true, data: { status: "restored", field: version.field, contactId: version.contactId } };
  }

  const key = companyKeyOf(version.field);
  if (!key) return { ok: true, data: { status: "gone" } };
  const current = company[key];
  if (!saw(current)) return { ok: true, data: { status: "changed" } };
  if ((version.value ?? null) === (current ?? null)) return { ok: true, data: { status: "unchanged" } };
  // The company form's own rules for this field (a website must be a web address, the caps).
  const parsed = companyFieldsSchema.shape[key].safeParse(version.value);
  if (!parsed.success) return { ok: false, error: `That previous ${label} can't be restored. ${parsed.error.issues[0].message}` };
  // The form trims what it saves, so a stored value with stray spaces can parse to what the field
  // holds now. Nothing would change, so say so instead of "restored", the way editContact does.
  if (sameText(parsed.data, current)) return { ok: true, data: { status: "unchanged" } };
  const original = { name: company.name, industry: company.industry, website: company.website, notes: company.notes };
  const saved = await updateCompany(member, input.companyId, { changes: { ...original, [key]: parsed.data }, original }, input.separateFrom ?? [], via);
  if (!saved.ok) return saved;
  if (saved.data.status === "conflict") return { ok: true, data: { status: "changed" } };
  if (saved.data.status === "possible-duplicates") return { ok: true, data: saved.data };
  return { ok: true, data: { status: "restored", field: version.field, contactId: null } };
}

// The sentence the company page shows for an outcome that restored nothing, or null.
export function restoreRefusal(outcome: RestoreOutcome): string | null {
  switch (outcome.status) {
    case "gone":
      return VERSION_GONE;
    case "changed":
      return VERSION_CHANGED;
    case "unchanged":
      return VERSION_SAME;
    case "possible-duplicates": {
      const [first] = outcome.matches;
      const more = outcome.total > 1 ? ` and ${outcome.total - 1} more` : "";
      return `Restoring it would make this company look like ${first?.name ?? "another company"}${more}. Use Edit details to make the change there and say whether they are the same company.`;
    }
    default:
      return null;
  }
}
