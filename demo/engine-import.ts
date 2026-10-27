import { planImport, previewImport, type ExistingCompany, type ImportPreview, type ImportResult } from "./csv";
import { asMember, done, nextId, refuse, type Step } from "./engine-core";
import { recordSeparate } from "./engine-companies";
import { domainKey, nameKey } from "./rules";
import type { ActionResult, Company, Contact, DemoState } from "./types";
import type { ImportMapping } from "./validation";

// The CSV import's two steps as commands. Parsing, column guessing, row checks and duplicate
// groups live in demo/csv.ts (a port of lib/csv.ts); this file only reads the workspace's companies
// for it and applies the plan it produces.

// Every company in the workspace, archived ones too, in the shape the duplicate search needs.
export function existingCompanies(state: DemoState, ws: string): ExistingCompany[] {
  return state.companies
    .filter((c) => c.workspaceId === ws)
    .map((c) => ({ id: c.id, name: c.name, website: c.website, nameKey: c.nameKey, domainKey: c.domainKey, archived: c.archivedAt !== null }));
}

// Step 1 and 2: the columns, the problems and the duplicate groups for a file. `mapping` null means
// "guess from the headers". Changes nothing, so it returns an ActionResult, not a Step.
export function previewCsv(state: DemoState, ws: string, text: string, mapping: ImportMapping | null): ActionResult<ImportPreview> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step.result;
  return previewImport(existingCompanies(state, ws), text, mapping);
}

// Step 3: adds the chosen rows as Not contacted companies, each with at most one contact. `skip` is
// the spreadsheet rows to leave out; `seen` is the existing look-alikes the preview showed. Importing
// a look-alike was chosen on purpose, so each such pair is remembered as separate entries.
export function runCsvImport(state: DemoState, ws: string, text: string, mapping: ImportMapping, skip: number[], seen: string[]): Step<ImportResult> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  const plan = planImport(existingCompanies(state, ws), text, mapping, skip, seen);
  if (!plan.ok) return refuse(state, plan.error);

  let next = state;
  const idOf = new Map<number, string>();
  const companies: Company[] = [];
  const contacts: Contact[] = [];
  for (const row of plan.data.toImport) {
    const company = nextId(next, "co");
    next = company.state;
    idOf.set(row.row, company.id);
    companies.push({
      id: company.id,
      workspaceId: ws,
      ...row.company,
      nameKey: nameKey(row.company.name),
      domainKey: domainKey(row.company.website),
      stage: "NOT_CONTACTED",
      nextFollowUpAt: null,
      lastContactedAt: null,
      claimedById: null,
      claimExpiresAt: null,
      archivedAt: null,
      createdAt: state.now,
      updatedAt: state.now,
    });
    if (row.contact) {
      const contact = nextId(next, "ct");
      next = contact.state;
      contacts.push({ id: contact.id, workspaceId: ws, companyId: company.id, ...row.contact, createdAt: state.now });
    }
  }
  next = { ...next, companies: [...next.companies, ...companies], contacts: [...next.contacts, ...contacts] };

  for (const group of plan.data.groups) {
    const imported = group.rows.flatMap((row) => (idOf.has(row) ? [idOf.get(row) as string] : []));
    const members = [...imported, ...group.existing.map((c) => c.id)];
    imported.forEach((id, i) => {
      next = recordSeparate(next, ws, id, members.slice(i + 1));
    });
  }
  return done(next, plan.data.result);
}
