import { COMPANY_NOT_FOUND, asMember, companyOf, done, heldMessage, liveClaimByOther, mapCompany, nextId, refuse, type Step } from "./engine-core";
import { domainKey, matchReasons, nameKey, orderedPair } from "./rules";
import type { Company, Contact, DemoState, MatchReason, PairDecision } from "./types";
import { checkCompanyFields, checkContactFields, type CompanyInput, type CheckedContact } from "./validation";

// Companies, contacts, duplicates and archiving: the rules of lib/companies.ts as pure commands.
// Nothing is ever merged, blocked or deleted automatically: look-alikes raise a flag a person
// resolves, and "remove" means archive.

// `archived` matches are included on purpose: re-adding a company that was archived last year
// offers to unarchive it, with its history, instead of starting an empty duplicate.
export type DuplicateMatch = { id: string; name: string; website: string | null; archived: boolean; matchedOn: MatchReason[] };

type EditableField = "name" | "industry" | "website" | "notes";
export type FieldConflict = { field: EditableField; theirs: string | null; yours: string | null };

// Saving either succeeds, stops to ask about look-alikes, or (for edits) stops because someone else
// changed the same field first.
export type SaveResult =
  | { status: "saved"; companyId: string }
  | { status: "possible-duplicates"; matches: DuplicateMatch[] }
  | { status: "conflict"; conflicts: FieldConflict[] };

const keysFor = (fields: { name: string; website?: string | null }) => ({ nameKey: nameKey(fields.name), domainKey: domainKey(fields.website) });

// Companies in this workspace (active or archived) that look like `keys`, minus pairs already
// marked separate. The pair filter applies only when an existing company is being edited.
export function findMatches(
  state: DemoState,
  ws: string,
  keys: { nameKey: string; domainKey: string | null },
  excludeId?: string,
): DuplicateMatch[] {
  const separate = new Set<string>();
  if (excludeId) {
    for (const d of state.pairDecisions) {
      if (d.workspaceId !== ws) continue;
      if (d.companyAId === excludeId) separate.add(d.companyBId);
      if (d.companyBId === excludeId) separate.add(d.companyAId);
    }
  }
  return state.companies
    .filter((c) => c.workspaceId === ws && c.id !== excludeId && (c.nameKey === keys.nameKey || (keys.domainKey !== null && c.domainKey === keys.domainKey)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .filter((c) => !separate.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, website: c.website, archived: c.archivedAt !== null, matchedOn: matchReasons(keys, c) }));
}

// Matches the person has not yet said are separate. Ids they acknowledged that are not real matches
// are ignored, so a stale list cannot create decisions for random companies.
function split(matches: DuplicateMatch[], separateFrom: string[]) {
  const acknowledged = new Set(separateFrom);
  return {
    unresolved: matches.filter((m) => !acknowledged.has(m.id)),
    confirmedSeparate: matches.filter((m) => acknowledged.has(m.id)).map((m) => m.id),
  };
}

// Remembers "these are separate" for each pair, so it stops being flagged.
export function recordSeparate(state: DemoState, ws: string, companyId: string, otherIds: string[]): DemoState {
  let next = state;
  for (const otherId of otherIds) {
    const [companyAId, companyBId] = orderedPair(companyId, otherId);
    if (next.pairDecisions.some((d) => d.workspaceId === ws && d.companyAId === companyAId && d.companyBId === companyBId)) continue;
    const withId = nextId(next, "pd");
    const decision: PairDecision = { id: withId.id, workspaceId: ws, companyAId, companyBId, decidedById: state.meId, decidedAt: state.now };
    next = { ...withId.state, pairDecisions: [...withId.state.pairDecisions, decision] };
  }
  return next;
}

// Adds a company, or returns the look-alikes to ask about. `separateFrom` is the ids of look-alikes
// the person said are separate ("Separate entries: save anyway").
export function createCompany(state: DemoState, ws: string, input: CompanyInput, separateFrom: string[] = []): Step<SaveResult> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const fields = checkCompanyFields(input);
  if (!fields.ok) return refuse(state, fields.errors[0]);

  const keys = keysFor(fields.data);
  const { unresolved, confirmedSeparate } = split(findMatches(state, ws, keys), separateFrom);
  if (unresolved.length > 0) return done(state, { status: "possible-duplicates", matches: unresolved });

  const withId = nextId(state, "co");
  const company: Company = {
    id: withId.id,
    workspaceId: ws,
    ...fields.data,
    ...keys,
    stage: "NOT_CONTACTED",
    nextFollowUpAt: null,
    lastContactedAt: null,
    claimedById: null,
    claimExpiresAt: null,
    archivedAt: null,
    createdAt: state.now,
    updatedAt: state.now,
  };
  const next = recordSeparate({ ...withId.state, companies: [...withId.state.companies, company] }, ws, company.id, confirmedSeparate);
  return done(next, { status: "saved", companyId: company.id });
}

const EDITABLE: EditableField[] = ["name", "industry", "website", "notes"];
const value = (fields: Partial<Record<EditableField, string | null | undefined>>, field: EditableField): string | null => fields[field] || null;

export type CompanyEdit = { changes: CompanyInput; original: CompanyInput };

// Saves only the fields the person changed, and only if each still holds the value their form
// loaded. Two people editing different fields both succeed; the same field is a conflict the second
// person sees (with the other value) instead of a silent overwrite.
export function updateCompany(state: DemoState, ws: string, companyId: string, edit: CompanyEdit, separateFrom: string[] = []): Step<SaveResult> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const fields = checkCompanyFields(edit.changes);
  if (!fields.ok) return refuse(state, fields.errors[0]);
  const current = companyOf(state, ws, companyId);
  if (!current) return refuse(state, COMPANY_NOT_FOUND);

  const changes: CompanyInput = fields.data;
  const changed = EDITABLE.filter((f) => value(changes, f) !== value(edit.original, f));
  if (changed.length === 0) return done(state, { status: "saved", companyId });

  const conflicts = changed
    .filter((f) => value(current, f) !== value(edit.original, f))
    .map((f): FieldConflict => ({ field: f, theirs: value(current, f), yours: value(changes, f) }));
  if (conflicts.length > 0) return done(state, { status: "conflict", conflicts });

  let next = state;
  let keys: ReturnType<typeof keysFor> | undefined;
  if (changed.includes("name") || changed.includes("website")) {
    keys = keysFor({ name: changes.name, website: value(changes, "website") });
    const { unresolved, confirmedSeparate } = split(findMatches(state, ws, keys, companyId), separateFrom);
    if (unresolved.length > 0) return done(state, { status: "possible-duplicates", matches: unresolved });
    next = recordSeparate(next, ws, companyId, confirmedSeparate);
  }
  next = mapCompany(next, companyId, (c) => ({
    ...c,
    ...Object.fromEntries(changed.map((f) => [f, value(changes, f)])),
    ...keys,
    updatedAt: state.now,
  }));
  return done(next, { status: "saved", companyId });
}

// Hides the company from the board and queue, keeping its history. A company someone else holds can
// only be archived by them or an owner; archiving clears the claim.
export function archiveCompany(state: DemoState, ws: string, companyId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const company = companyOf(state, ws, companyId);
  if (!company || company.archivedAt) return refuse(state, COMPANY_NOT_FOUND);
  if (liveClaimByOther(state, company) && checked.member.role !== "owner") return refuse(state, heldMessage(state, company));
  return done(mapCompany(state, companyId, (c) => ({ ...c, claimedById: null, claimExpiresAt: null, archivedAt: state.now, updatedAt: state.now })), undefined);
}

export function unarchiveCompany(state: DemoState, ws: string, companyId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const company = companyOf(state, ws, companyId);
  if (!company || !company.archivedAt) return refuse(state, COMPANY_NOT_FOUND);
  return done(mapCompany(state, companyId, (c) => ({ ...c, archivedAt: null, updatedAt: state.now })), undefined);
}

// "These are the same": keep one and archive the other, under the same claim rule as archiving.
// Serves both "Same company: archive this one" (editing) and the board's Possible duplicates box.
export function resolveAsDuplicate(state: DemoState, ws: string, keepId: string, archiveId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (keepId === archiveId) return refuse(state, "Pick two different companies.");
  const keep = companyOf(state, ws, keepId);
  const drop = companyOf(state, ws, archiveId);
  if (!keep || !drop || keep.archivedAt || drop.archivedAt) return refuse(state, COMPANY_NOT_FOUND);
  return archiveCompany(state, ws, archiveId);
}

// "These are separate": remembered so the pair stops being flagged.
export function markSeparate(state: DemoState, ws: string, companyId: string, otherId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (companyId === otherId) return refuse(state, "Pick two different companies.");
  if (!companyOf(state, ws, companyId) || !companyOf(state, ws, otherId)) return refuse(state, COMPANY_NOT_FOUND);
  return done(recordSeparate(state, ws, companyId, [otherId]), undefined);
}

// ----- Contacts -----

export function addContact(state: DemoState, ws: string, companyId: string, input: { name: string; email?: string | null; title?: string | null }): Step<{ contactId: string }> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const fields = checkContactFields(input);
  if (!fields.ok) return refuse(state, fields.errors[0]);
  if (!companyOf(state, ws, companyId)) return refuse(state, COMPANY_NOT_FOUND);
  const withId = nextId(state, "ct");
  const contact: Contact = { id: withId.id, workspaceId: ws, companyId, ...(fields.data as CheckedContact), createdAt: state.now };
  return done({ ...withId.state, contacts: [...withId.state.contacts, contact] }, { contactId: contact.id });
}

export function updateContact(state: DemoState, ws: string, contactId: string, input: { name: string; email?: string | null; title?: string | null }): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const fields = checkContactFields(input);
  if (!fields.ok) return refuse(state, fields.errors[0]);
  if (!state.contacts.some((c) => c.id === contactId && c.workspaceId === ws)) return refuse(state, "Contact not found.");
  return done({ ...state, contacts: state.contacts.map((c) => (c.id === contactId ? { ...c, ...fields.data } : c)) }, undefined);
}

// Contacts are people's details, not company history, so removing one really deletes it.
export function removeContact(state: DemoState, ws: string, contactId: string): Step {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (!state.contacts.some((c) => c.id === contactId && c.workspaceId === ws)) return refuse(state, "Contact not found.");
  return done({ ...state, contacts: state.contacts.filter((c) => c.id !== contactId) }, undefined);
}
