import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import type { Prisma, Stage } from "@/generated/prisma/client";
import type { ContactFields, CompanyFields } from "@/lib/companies";
import { advisoryXactLock, withTenant, type Tenant } from "@/lib/db";
import { findContained, loadSavedNames, type NameLookalike } from "@/lib/csv-contained";
import { domainKey, groupLookAlikes, nameKey, orderedPair, type MatchReason } from "@/lib/duplicates";
import {
  companyFieldsSchema,
  contactFieldsSchema,
  IMPORT_FIELDS,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  type ActionResult,
  type ImportMapping,
} from "@/lib/validation";

// CSV import. The server is the source of truth: the browser parses the file only
// to show it quickly, and every step here parses the same file again, checks every row with the
// same rules as the Add company form, and finds duplicates again. Nothing is merged or skipped
// silently: rows with errors are reported, and look-alikes are shown for a person to decide.

type Tx = Prisma.TransactionClient;

export type Table = { headers: string[]; rows: { row: number; cells: string[] }[] };

// Parses CSV text into headers and rows. `row` is the spreadsheet row number (the header is row
// 1), so messages match what people see in Google Sheets or Excel. Handles a byte-order mark,
// Windows line endings, quoted commas and line breaks, and blank lines; refuses broken quoting.
const NOT_UTF8 = "This file isn't UTF-8 text. In Excel choose CSV UTF-8; in Google Sheets, File, Download, Comma-separated values.";
export function parseCsv(text: string): ActionResult<Table> {
  // A NUL character means binary or UTF-16 text read the wrong way; Postgres would refuse it.
  if (text.includes("\u0000")) return { ok: false, error: NOT_UTF8 };
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  const quoteError = parsed.errors.find((e) => e.type === "Quotes");
  if (quoteError) {
    // Papa Parse always says which record a quote error is in (0 is the header row).
    return { ok: false, error: `Row ${(quoteError.row as number) + 1} has a quote that never closes. Fix it in the sheet and export again.` };
  }

  const [headerCells = [], ...records] = parsed.data;
  if (headerCells.every((h) => h.trim() === "")) return { ok: false, error: "The file needs a header row with column names." };
  if (headerCells.length > IMPORT_MAX_COLUMNS) return { ok: false, error: `The file has more than ${IMPORT_MAX_COLUMNS} columns.` };

  // Blank headers get a name, and repeated ones a number, so every column can be told apart.
  const seen = new Map<string, number>();
  const headers = headerCells.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });

  const rows = records
    .map((cells, i) => ({ row: i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { ok: false, error: "The file has no rows under its header." };
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `The file has ${rows.length} rows; the limit is ${IMPORT_MAX_ROWS}. Split it into smaller files.` };
  }
  return { ok: true, data: { headers, rows } };
}

// Header words that suggest each field, checked in this order so "Contact Email" becomes the
// contact's email rather than their name, and "Company Name" the company rather than a contact.
const GUESSES: [keyof ImportMapping, RegExp][] = [
  ["contactEmail", /\be ?mail\b/],
  ["website", /\b(website|web site|url|domain|site|link)\b/],
  ["contactName", /\b(contact|recruiter|poc|point of contact|person|rep)\b/],
  ["industry", /\b(industry|sector|category|field)\b/],
  ["notes", /\b(notes?|comments?|status|history|details|remarks)\b/],
  ["name", /\b(company|organization|organisation|org|sponsor|business|employer|name)\b/],
];

// Whether the name column was found from its header, or only assumed (no header looked like one).
function nameHeaderFound(headers: string[], mapping: ImportMapping): boolean {
  const pattern = GUESSES.find(([field]) => field === "name")?.[1];
  const header = headers[mapping.name]?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
  return Boolean(pattern?.test(header));
}

// A first guess at which column fills which field, from the headers. Each column is used once;
// if no header looks like a company name, the first column is assumed to be it.
export function guessMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = { name: -1, industry: null, website: null, notes: null, contactName: null, contactEmail: null };
  const used = new Set<number>();
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  for (const [field, pattern] of GUESSES) {
    const index = normalized.findIndex((h, i) => !used.has(i) && pattern.test(h));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  if (mapping.name === -1) {
    const free = [...headers.keys()].find((i) => !used.has(i));
    if (free !== undefined) {
      mapping.name = free;
    } else {
      // Every column was guessed as something else (a one-column file headed "Email", say):
      // the first column becomes the name, and whatever field had it is cleared.
      for (const field of IMPORT_FIELDS) if (field !== "name" && mapping[field] === 0) mapping[field] = null;
      mapping.name = 0;
    }
  }
  return mapping;
}

export type CheckedRow = {
  row: number;
  company: CompanyFields;
  contact: ContactFields | null;
  errors: string[];
  // Never block the row: what was left out of it, and why ("contact left out: no valid email").
  warnings: string[];
};

// A cell that held bytes the file's encoding couldn't map (U+FFFD): never saved.
const UNREADABLE = "\uFFFD";
const UNREADABLE_ROW = "This row has characters Coppice can't read. In Excel use Save As, CSV UTF-8.";

const namedFromEmailWarning = (name: string) => `Contact named "${name}" from their email.`;
// Whether a row's contact is only a stand-in made from its email (no name cell), so a real name
// found elsewhere (Smart import's reading of the notes) may take its place.
export const namedFromEmail = (row: Pick<CheckedRow, "contact" | "warnings">) =>
  Boolean(row.contact?.email) && row.warnings.includes(namedFromEmailWarning(row.contact?.name ?? ""));

// The contact a row brings, if any, and what was left out. A company is never refused over its
// contact: with an email and no name, the name is the email's first part ("hello" for
// hello@orbit.com); a bad email is left out (with the name kept, when there is one).
function checkContact(nameCell: string, emailCell: string): { contact: ContactFields | null; warnings: string[] } {
  const name = nameCell.trim();
  const email = emailCell.trim();
  if (!name && !email) return { contact: null, warnings: [] };
  const warnings: string[] = [];
  const parsedEmail = email ? contactFieldsSchema.shape.email.safeParse(email) : null;
  const goodEmail = parsedEmail?.success ? parsedEmail.data : null;
  if (email && !goodEmail) warnings.push(name ? "Contact email left out: not a valid address." : "Contact left out: no valid email.");
  let contactName = name;
  if (!contactName && goodEmail) {
    contactName = goodEmail.split("@")[0];
    warnings.push(namedFromEmailWarning(contactName));
  }
  if (!contactName) return { contact: null, warnings };
  const parsed = contactFieldsSchema.safeParse({ name: contactName, email: goodEmail, title: null });
  if (!parsed.success) return { contact: null, warnings: [...warnings, `Contact left out: ${parsed.error.issues[0].message}`] };
  return { contact: parsed.data, warnings };
}

// Checks every row with the same rules as the Add company form. The contact is checked like the
// Add contact form, but only ever leaves the row with a warning.
export function checkRows(table: Table, mapping: ImportMapping): ActionResult<CheckedRow[]> {
  const outOfRange = Object.values(mapping).some((c) => c !== null && c >= table.headers.length);
  if (outOfRange) return { ok: false, error: "The column choices don't match this file. Choose them again." };

  return {
    ok: true,
    data: table.rows.map(({ row, cells }) => {
      const cell = (field: keyof ImportMapping) => {
        const index = mapping[field];
        return index === null ? "" : (cells[index] ?? "");
      };
      const errors: string[] = [];

      const companyInput = { name: cell("name"), industry: cell("industry"), website: cell("website"), notes: cell("notes") };
      const unreadable = [...Object.values(companyInput), cell("contactName"), cell("contactEmail")].some((v) => v.includes(UNREADABLE));
      const company = companyFieldsSchema.safeParse(companyInput);
      if (unreadable) errors.push(UNREADABLE_ROW);
      else if (!company.success) errors.push(...company.error.issues.map((i) => i.message));

      const { contact, warnings } = errors.length ? { contact: null, warnings: [] } : checkContact(cell("contactName"), cell("contactEmail"));

      // Rows with errors show what was typed (trimmed); good rows show the checked values.
      const typed = (value: string) => value.trim() || null;
      const shown =
        company.success && !unreadable
          ? company.data
          : { name: companyInput.name.trim(), industry: typed(companyInput.industry), website: typed(companyInput.website), notes: typed(companyInput.notes) };
      return { row, company: shown, contact, errors, warnings };
    }),
  };
}

export type ExistingMatch = { id: string; name: string; website: string | null; archived: boolean };
// Rows (and existing companies) that look alike: same name ignoring case and legal suffixes, or
// same website domain. Linked transitively: if row 3 matches row 5 by name and row 5 matches an
// existing company by website, all three are one group.
type DuplicateGroup = { rows: number[]; existing: ExistingMatch[]; matchedOn: MatchReason[] };

async function findGroups(tx: Tx, workspaceId: string, rows: CheckedRow[]): Promise<DuplicateGroup[]> {
  const keyed = rows.map((r) => ({ row: r.row, nameKey: nameKey(r.company.name), domainKey: domainKey(r.company.website) }));
  if (keyed.length === 0) return [];
  const names = [...new Set(keyed.map((k) => k.nameKey))];
  const domains = [...new Set(keyed.flatMap((k) => (k.domainKey ? [k.domainKey] : [])))];
  const existing = await tx.company.findMany({
    where: { workspaceId, OR: [{ nameKey: { in: names } }, ...(domains.length ? [{ domainKey: { in: domains } }] : [])] },
    select: { id: true, name: true, website: true, archivedAt: true, nameKey: true, domainKey: true },
    orderBy: { createdAt: "asc" },
  });

  const items = [
    ...existing.map((c) => ({ ...c, row: null })),
    ...keyed.map((k) => ({ ...k, id: `row:${k.row}`, name: "", website: null, archivedAt: null })),
  ];
  // A group matters if it has a row from the file and something else: another row or a company.
  // Its reasons are only the ones a row shares: two saved companies that share a website don't
  // make a row's group "same website".
  const viaRow = (members: typeof items, reason: MatchReason) => {
    const keyOf = (m: (typeof items)[number]) => (reason === "name" ? m.nameKey : m.domainKey);
    const count = new Map<string, number>();
    for (const m of members) {
      const key = keyOf(m);
      if (key) count.set(key, (count.get(key) ?? 0) + 1);
    }
    return members.some((m) => m.row !== null && (count.get(keyOf(m) ?? "") ?? 0) > 1);
  };
  return groupLookAlikes(items)
    .map((g) => ({
      rows: g.members.flatMap((m) => (m.row === null ? [] : [m.row])).sort((a, b) => a - b),
      existing: g.members.flatMap((m) => (m.row === null ? [{ id: m.id, name: m.name, website: m.website, archived: m.archivedAt !== null }] : [])),
      matchedOn: g.matchedOn.filter((reason) => viaRow(g.members, reason)),
    }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.rows[0] - b.rows[0]);
}

// What the person sees before importing: suggested defaults are to skip rows that match a
// company already in the workspace, and inside the file to import the first of each look-alike
// group and skip the rest.
function defaultSkips(groups: DuplicateGroup[]): number[] {
  return groups.flatMap((g) => (g.existing.length > 0 ? g.rows : g.rows.slice(1))).sort((a, b) => a - b);
}

export type ImportPreview = {
  headers: string[];
  mapping: ImportMapping;
  rowCount: number;
  // The first 10 rows as they'll be imported, with their problems.
  sample: CheckedRow[];
  // Every row that can't be imported, and why (with the name as typed, for the result's list).
  errors: { row: number; name: string; messages: string[] }[];
  // Rows that import with something left out (a contact without a valid email). Never blocking.
  warnings: { row: number; name: string; messages: string[] }[];
  // Whether the name column was only assumed (no header looked like a company name).
  nameAssumed: boolean;
  // Set when the file wasn't UTF-8 and was read as Windows (Western) text instead.
  encodingGuess?: "windows-1252";
  groups: DuplicateGroup[];
  // Names inside other names, shown with the groups above; they suggest no skips.
  contained: NameLookalike[];
  // Name and website of every row that's in a group, so the choices can say which row is which.
  labels: { row: number; name: string; website: string | null }[];
  defaultSkips: number[];
  // Existing companies shown as possible duplicates; sent back with the import, so a company
  // added in between is noticed instead of slipping through.
  seen: string[];
  // The name of every row that can be imported, so the result can say which went in.
  names: { row: number; name: string }[];
};

const PREVIEW_ROWS = 10;

export async function previewImport(
  tenant: Tenant,
  text: string,
  mapping: ImportMapping | null,
  encodingGuess?: "windows-1252",
): Promise<ActionResult<ImportPreview>> {
  const table = parseCsv(text);
  if (!table.ok) return table;
  const chosen = mapping ?? guessMapping(table.data.headers);
  const checked = checkRows(table.data, chosen);
  if (!checked.ok) return checked;

  const valid = checked.data.filter((r) => r.errors.length === 0);
  const { groups, saved } = await withTenant(tenant, async (tx) => ({
    groups: await findGroups(tx, tenant.workspaceId, valid),
    saved: valid.length > 0 ? await loadSavedNames(tx, tenant.workspaceId) : [],
  }));
  // Compared after the transaction has closed: it is plain code over every saved name.
  const contained = findContained(valid, saved);
  const grouped = new Set(groups.flatMap((g) => g.rows));
  return {
    ok: true,
    data: {
      headers: table.data.headers,
      mapping: chosen,
      rowCount: checked.data.length,
      sample: checked.data.slice(0, PREVIEW_ROWS),
      errors: checked.data.filter((r) => r.errors.length > 0).map((r) => ({ row: r.row, name: r.company.name, messages: r.errors })),
      warnings: valid.filter((r) => r.warnings.length > 0).map((r) => ({ row: r.row, name: r.company.name, messages: r.warnings })),
      nameAssumed: mapping === null && !nameHeaderFound(table.data.headers, chosen),
      ...(encodingGuess ? { encodingGuess } : {}),
      groups,
      contained,
      labels: valid.filter((r) => grouped.has(r.row)).map((r) => ({ row: r.row, name: r.company.name, website: r.company.website ?? null })),
      defaultSkips: defaultSkips(groups),
      seen: groups.flatMap((g) => g.existing.map((c) => c.id)),
      names: valid.map((r) => ({ row: r.row, name: r.company.name })),
    },
  };
}

export type ImportResult = { imported: number; skipped: number; errored: number };

// Smart import (lib/smart-import/) passes a hook that, inside the import's transaction, checks
// what the person accepted from the AI's reading and returns it per row: a stage, dates, a line
// added to the notes, and a contact for a row that has none. It also returns the look-alike groups
// it flagged (rows and existing company ids), recorded like the exact ones below when imported.
// Without a hook nothing changes.
export type RowExtras = { stage?: Stage; lastContactedAt?: Date; nextFollowUpAt?: Date; noteLine?: string; contact?: ContactFields };
export type SmartExtras = { rows: Map<number, RowExtras>; lookalikes: { rows: number[]; existing: string[] }[] };
export type SmartHook = (tx: Tx, rows: CheckedRow[]) => Promise<ActionResult<SmartExtras>>;

const withNoteLine = (notes: string | null, line: string | undefined) => (line ? (notes ? `${notes}\n\n${line}` : line) : notes);

// Imports the file in one transaction: either every chosen row goes in, or none do.
// `skip` is the rows the person chose to skip; `seen` is the existing look-alikes their preview
// showed. Importing a row that matched an existing company (or another imported row) records the
// pair as "separate entries", like Add company does, so it isn't flagged again.
export async function runImport(
  tenant: Tenant,
  text: string,
  mapping: ImportMapping,
  skip: number[],
  seen: string[],
  smart?: SmartHook,
): Promise<ActionResult<ImportResult>> {
  const table = parseCsv(text);
  if (!table.ok) return table;
  const checked = checkRows(table.data, mapping);
  if (!checked.ok) return checked;
  const valid = checked.data.filter((r) => r.errors.length === 0);
  const errored = checked.data.length - valid.length;

  const validRows = new Set(valid.map((r) => r.row));
  if (skip.some((row) => !validRows.has(row))) return { ok: false, error: "The import choices don't match this file. Review it again." };
  const skipped = new Set(skip);

  return withTenant(tenant, async (tx) => {
    // Two imports into one workspace go one after the other, so the second sees what the first
    // added (and its seen-check refuses it) instead of both passing before either writes.
    await advisoryXactLock(tx, `import:${tenant.workspaceId}`);
    const groups = await findGroups(tx, tenant.workspaceId, valid);
    const seenIds = new Set(seen);
    if (groups.some((g) => g.existing.some((c) => !seenIds.has(c.id)))) {
      return { ok: false, error: "A company that looks like rows in this file was added since your preview. Review the duplicates again." };
    }

    const toImport = valid.filter((r) => !skipped.has(r.row));
    const idOf = new Map(toImport.map((r) => [r.row, randomUUID()]));
    const extras = smart ? await smart(tx, toImport) : null;
    if (extras && !extras.ok) return extras;
    const extra = (row: number) => extras?.data.rows.get(row);

    // Imported look-alikes were chosen on purpose: remember them as separate. A star, not every
    // pair: each imported row with each saved company it looked like, and with the group's first
    // imported row. Worked out before writing, so an import that would record too many is refused
    // whole.
    const flagged = [...groups.map((g) => ({ rows: g.rows, existing: g.existing.map((c) => c.id) })), ...(extras?.data.lookalikes ?? [])];
    const pairs = new Map<string, [string, string]>();
    for (const g of flagged) {
      const imported = g.rows.flatMap((row) => (idOf.has(row) ? [idOf.get(row) as string] : []));
      const [anchor, ...rest] = imported;
      for (const id of imported) for (const other of g.existing) pairs.set(orderedPair(id, other).join("|"), orderedPair(id, other));
      for (const id of rest) pairs.set(orderedPair(id, anchor).join("|"), orderedPair(id, anchor));
      if (pairs.size > IMPORT_MAX_PAIRS) {
        return { ok: false, error: "Too many of these rows look alike to import together. Skip more of the look-alikes, or split the file." };
      }
    }

    // Written in chunks, one after another: one statement at a time on the transaction's connection.
    await inChunks(
      toImport.map((r) => ({
        id: idOf.get(r.row) as string,
        workspaceId: tenant.workspaceId,
        ...r.company,
        ...(extra(r.row) && {
          notes: withNoteLine(r.company.notes ?? null, extra(r.row)?.noteLine),
          stage: extra(r.row)?.stage,
          lastContactedAt: extra(r.row)?.lastContactedAt,
          nextFollowUpAt: extra(r.row)?.nextFollowUpAt,
        }),
        nameKey: nameKey(r.company.name),
        domainKey: domainKey(r.company.website),
      })),
      (data) => tx.company.createMany({ data }),
    );
    await inChunks(
      toImport.flatMap((r) => {
        // Smart import's contact is only ever set for a row with none, or with a stand-in named from
        // the email, and it carries that email (lib/smart-import/commit.ts).
        const contact = extra(r.row)?.contact ?? r.contact;
        return contact ? [{ workspaceId: tenant.workspaceId, companyId: idOf.get(r.row) as string, ...contact }] : [];
      }),
      (data) => tx.contact.createMany({ data }),
    );
    await inChunks(
      [...pairs.values()].map(([companyAId, companyBId]) => ({ workspaceId: tenant.workspaceId, companyAId, companyBId, decidedById: tenant.userId })),
      (data) => tx.companyPairDecision.createMany({ data, skipDuplicates: true }),
    );

    return { ok: true, data: { imported: toImport.length, skipped: skipped.size, errored } };
  });
}

// At most this many look-alike pairs are remembered by one import.
const IMPORT_MAX_PAIRS = 5000;
const CHUNK = 500;

async function inChunks<T>(items: T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) await write(items.slice(i, i + CHUNK));
}
