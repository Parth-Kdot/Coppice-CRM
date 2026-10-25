import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import type { Prisma } from "@/generated/prisma/client";
import type { ContactFields, CompanyFields } from "@/lib/companies";
import { withTenant, type Tenant } from "@/lib/db";
import { domainKey, nameKey, orderedPair, type MatchReason } from "@/lib/duplicates";
import {
  companyFieldsSchema,
  contactFieldsSchema,
  IMPORT_FIELDS,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  type ActionResult,
  type ImportMapping,
} from "@/lib/validation";

// CSV import (Milestone 4). The server is the source of truth: the browser parses the file only
// to show it quickly, and every step here parses the same file again, checks every row with the
// same rules as the Add company form, and finds duplicates again. Nothing is merged or skipped
// silently: rows with errors are reported, and look-alikes are shown for a person to decide.

type Tx = Prisma.TransactionClient;

export type Table = { headers: string[]; rows: { row: number; cells: string[] }[] };

// Parses CSV text into headers and rows. `row` is the spreadsheet row number (the header is row
// 1), so messages match what people see in Google Sheets or Excel. Handles a byte-order mark,
// Windows line endings, quoted commas and line breaks, and blank lines; refuses broken quoting.
export function parseCsv(text: string): ActionResult<Table> {
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
};

// Checks every row with the same rules as the Add company and Add contact forms.
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
      const company = companyFieldsSchema.safeParse(companyInput);
      if (!company.success) errors.push(...company.error.issues.map((i) => i.message));

      let contact: ContactFields | null = null;
      if (cell("contactName").trim() || cell("contactEmail").trim()) {
        const parsed = contactFieldsSchema.safeParse({ name: cell("contactName"), email: cell("contactEmail"), title: null });
        if (parsed.success) contact = parsed.data;
        else errors.push(...parsed.error.issues.map((i) => `Contact: ${i.message}`));
      }

      // Rows with errors show what was typed (trimmed); good rows show the checked values.
      const typed = (value: string) => value.trim() || null;
      const shown = company.success
        ? company.data
        : { name: companyInput.name.trim(), industry: typed(companyInput.industry), website: typed(companyInput.website), notes: typed(companyInput.notes) };
      return { row, company: shown, contact, errors };
    }),
  };
}

export type ExistingMatch = { id: string; name: string; website: string | null; archived: boolean };
// Rows (and existing companies) that look alike: same name ignoring case and legal suffixes, or
// same website domain. Linked transitively: if row 3 matches row 5 by name and row 5 matches an
// existing company by website, all three are one group.
export type DuplicateGroup = { rows: number[]; existing: ExistingMatch[]; matchedOn: MatchReason[] };

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

  // Union-find over "row:3" and "company:<id>" nodes, joined whenever they share a key.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const firstWithKey = new Map<string, string>();
  const reasons = new Map<string, Set<MatchReason>>();
  const link = (node: string, key: string, reason: MatchReason) => {
    const other = firstWithKey.get(key);
    if (other === undefined) {
      firstWithKey.set(key, node);
      return;
    }
    union(node, other);
    reasons.set(key, (reasons.get(key) ?? new Set()).add(reason));
  };
  const nodes = [
    ...existing.map((c) => ({ node: `company:${c.id}`, nameKey: c.nameKey, domainKey: c.domainKey })),
    ...keyed.map((k) => ({ node: `row:${k.row}`, nameKey: k.nameKey, domainKey: k.domainKey })),
  ];
  for (const n of nodes) {
    link(n.node, `name:${n.nameKey}`, "name");
    if (n.domainKey) link(n.node, `site:${n.domainKey}`, "website");
  }

  // Gather each group's members, and which kinds of key joined it.
  const groups = new Map<string, { rows: number[]; existing: ExistingMatch[]; matchedOn: Set<MatchReason> }>();
  const groupOf = (node: string) => {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, { rows: [], existing: [], matchedOn: new Set() });
    return groups.get(root)!;
  };
  for (const c of existing) groupOf(`company:${c.id}`).existing.push({ id: c.id, name: c.name, website: c.website, archived: c.archivedAt !== null });
  for (const k of keyed) groupOf(`row:${k.row}`).rows.push(k.row);
  for (const [key, why] of reasons) {
    const member = firstWithKey.get(key) as string;
    for (const r of why) groupOf(member).matchedOn.add(r);
  }

  // A group matters if it has a row from the file and something else: another row or a company.
  return [...groups.values()]
    .filter((g) => g.rows.length > 0 && g.rows.length + g.existing.length > 1)
    .map((g) => ({ rows: g.rows.sort((a, b) => a - b), existing: g.existing, matchedOn: [...g.matchedOn].sort() as MatchReason[] }))
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
  // Every row that can't be imported, and why.
  errors: { row: number; messages: string[] }[];
  groups: DuplicateGroup[];
  defaultSkips: number[];
  // Existing companies shown as possible duplicates; sent back with the import, so a company
  // added in between is noticed instead of slipping through.
  seen: string[];
};

export const PREVIEW_ROWS = 10;

export async function previewImport(tenant: Tenant, text: string, mapping: ImportMapping | null): Promise<ActionResult<ImportPreview>> {
  const table = parseCsv(text);
  if (!table.ok) return table;
  const chosen = mapping ?? guessMapping(table.data.headers);
  const checked = checkRows(table.data, chosen);
  if (!checked.ok) return checked;

  const valid = checked.data.filter((r) => r.errors.length === 0);
  const groups = await withTenant(tenant, (tx) => findGroups(tx, tenant.workspaceId, valid));
  return {
    ok: true,
    data: {
      headers: table.data.headers,
      mapping: chosen,
      rowCount: checked.data.length,
      sample: checked.data.slice(0, PREVIEW_ROWS),
      errors: checked.data.filter((r) => r.errors.length > 0).map((r) => ({ row: r.row, messages: r.errors })),
      groups,
      defaultSkips: defaultSkips(groups),
      seen: groups.flatMap((g) => g.existing.map((c) => c.id)),
    },
  };
}

export type ImportResult = { imported: number; skipped: number; errored: number };

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
    const groups = await findGroups(tx, tenant.workspaceId, valid);
    const seenIds = new Set(seen);
    if (groups.some((g) => g.existing.some((c) => !seenIds.has(c.id)))) {
      return { ok: false, error: "A company that looks like rows in this file was added since your preview. Review the duplicates again." };
    }

    const toImport = valid.filter((r) => !skipped.has(r.row));
    const idOf = new Map(toImport.map((r) => [r.row, randomUUID()]));

    await tx.company.createMany({
      data: toImport.map((r) => ({
        id: idOf.get(r.row) as string,
        workspaceId: tenant.workspaceId,
        ...r.company,
        nameKey: nameKey(r.company.name),
        domainKey: domainKey(r.company.website),
      })),
    });
    await tx.contact.createMany({
      data: toImport.flatMap((r) => (r.contact ? [{ workspaceId: tenant.workspaceId, companyId: idOf.get(r.row) as string, ...r.contact }] : [])),
    });

    // Imported look-alikes were chosen on purpose: remember each pair as separate.
    const pairs = groups.flatMap((g) => {
      const imported = g.rows.flatMap((row) => (idOf.has(row) ? [idOf.get(row) as string] : []));
      const members = [...imported, ...g.existing.map((c) => c.id)];
      return imported.flatMap((id, i) => members.slice(i + 1).map((other) => orderedPair(id, other)));
    });
    await tx.companyPairDecision.createMany({
      data: pairs.map(([companyAId, companyBId]) => ({ workspaceId: tenant.workspaceId, companyAId, companyBId, decidedById: tenant.userId })),
      skipDuplicates: true,
    });

    return { ok: true, data: { imported: toImport.length, skipped: skipped.size, errored } };
  });
}
