import Papa from "papaparse";
import { domainKey, groupLookAlikes, nameKey } from "@/lib/duplicates";
import type { ActionResult, MatchReason } from "./types";
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  checkCompanyFields,
  checkContactFields,
  type CheckedContact,
  type ImportMapping,
} from "./validation";

// The CSV import, as pure functions. It follows lib/csv.ts step by step: parse the sheet, guess the
// columns, check every row with the same rules as the Add company form, group look-alikes (inside
// the file and against companies already in the workspace), then import what the person chose.
// Nothing is skipped or merged silently: problems are reported and look-alikes are shown to decide.

export type Table = { headers: string[]; rows: { row: number; cells: string[] }[] };

// Checks the file the person picked, before reading it. Browsers give a File with a name and size.
export function checkImportFile(file: { name: string; size: number } | null): ActionResult {
  if (!file || file.size === 0) return { ok: false, error: "Choose a .csv file." };
  if (!/\.csv$/i.test(file.name)) return { ok: false, error: "Choose a .csv file. In Google Sheets: File, Download, Comma-separated values." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, error: "The file is over 3 MB. Split it into smaller files." };
  return { ok: true, data: undefined };
}

// Parses CSV text into headers and rows. `row` is the spreadsheet row number (the header is row 1),
// so messages match what people see in Google Sheets or Excel. Handles a byte-order mark, Windows
// line endings, quoted commas and line breaks, and blank lines; refuses broken quoting.
export function parseCsv(text: string): ActionResult<Table> {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  const quoteError = parsed.errors.find((e) => e.type === "Quotes");
  if (quoteError) {
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

  const rows = records.map((cells, i) => ({ row: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim() !== ""));
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

// A first guess at which column fills which field, from the headers. Each column is used once; if
// no header looks like a company name, the first column is assumed to be it.
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
      for (const field of IMPORT_FIELDS) if (field !== "name" && mapping[field] === 0) mapping[field] = null;
      mapping.name = 0;
    }
  }
  return mapping;
}

// A column can only fill one field.
export function checkMapping(mapping: ImportMapping): ActionResult<ImportMapping> {
  const used = Object.values(mapping).filter((c): c is number => c !== null);
  if (new Set(used).size !== used.length) return { ok: false, error: "Each column can only fill one field." };
  if (mapping.name === null || mapping.name < 0) return { ok: false, error: "Choose a column for each field." };
  return { ok: true, data: mapping };
}

export type CheckedRow = {
  row: number;
  company: { name: string; industry: string | null; website: string | null; notes: string | null };
  contact: CheckedContact | null;
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

      const input = { name: cell("name"), industry: cell("industry"), website: cell("website"), notes: cell("notes") };
      const company = checkCompanyFields(input);
      if (!company.ok) errors.push(...company.errors);

      let contact: CheckedContact | null = null;
      if (cell("contactName").trim() || cell("contactEmail").trim()) {
        const parsed = checkContactFields({ name: cell("contactName"), email: cell("contactEmail"), title: null });
        if (parsed.ok) contact = parsed.data;
        else errors.push(...parsed.errors.map((message) => `Contact: ${message}`));
      }

      // Rows with errors show what was typed (trimmed); good rows show the checked values.
      const typed = (value: string) => value.trim() || null;
      const shown = company.ok
        ? company.data
        : { name: input.name.trim(), industry: typed(input.industry), website: typed(input.website), notes: typed(input.notes) };
      return { row, company: shown, contact, errors };
    }),
  };
}

// Companies already in the workspace, as the import needs to see them.
export type ExistingCompany = { id: string; name: string; website: string | null; nameKey: string; domainKey: string | null; archived: boolean };
export type ExistingMatch = { id: string; name: string; website: string | null; archived: boolean };

// Rows (and existing companies) that look alike: same name ignoring case and legal suffixes, or the
// same website domain. Linked transitively: if row 3 matches row 5 by name and row 5 matches an
// existing company by website, all three are one group.
export type DuplicateGroup = { rows: number[]; existing: ExistingMatch[]; matchedOn: MatchReason[] };

function findGroups(existing: ExistingCompany[], rows: CheckedRow[]): DuplicateGroup[] {
  const keyed = rows.map((r) => ({ row: r.row, nameKey: nameKey(r.company.name), domainKey: domainKey(r.company.website) }));
  if (keyed.length === 0) return [];
  const names = new Set(keyed.map((k) => k.nameKey));
  const domains = new Set(keyed.flatMap((k) => (k.domainKey ? [k.domainKey] : [])));
  const candidates = existing.filter((c) => names.has(c.nameKey) || (c.domainKey !== null && domains.has(c.domainKey)));

  type Item = { id: string; nameKey: string; domainKey: string | null; row: number | null; existing: ExistingCompany | null };
  const items: Item[] = [
    ...candidates.map((c) => ({ id: c.id, nameKey: c.nameKey, domainKey: c.domainKey, row: null, existing: c })),
    ...keyed.map((k) => ({ id: `row:${k.row}`, nameKey: k.nameKey, domainKey: k.domainKey, row: k.row, existing: null })),
  ];
  // A group matters if it has a row from the file and something else: another row or a company.
  return groupLookAlikes(items)
    .map((g) => ({
      rows: g.members.flatMap((m) => (m.row === null ? [] : [m.row])).sort((a, b) => a - b),
      existing: g.members.flatMap((m) =>
        m.existing ? [{ id: m.existing.id, name: m.existing.name, website: m.existing.website, archived: m.existing.archived }] : [],
      ),
      matchedOn: g.matchedOn,
    }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.rows[0] - b.rows[0]);
}

// The suggested choices: skip rows that match a company already in the workspace, and inside the
// file import the first of each look-alike group and skip the rest.
function defaultSkips(groups: DuplicateGroup[]): number[] {
  return groups.flatMap((g) => (g.existing.length > 0 ? g.rows : g.rows.slice(1))).sort((a, b) => a - b);
}

export type ImportPreview = {
  headers: string[];
  mapping: ImportMapping;
  rowCount: number;
  // The first 10 rows as they will be imported, with their problems.
  sample: CheckedRow[];
  // Every row that cannot be imported, and why.
  errors: { row: number; messages: string[] }[];
  groups: DuplicateGroup[];
  // Name and website of every row that is in a group, so the choices can say which row is which.
  labels: { row: number; name: string; website: string | null }[];
  defaultSkips: number[];
  // Existing companies shown as possible duplicates; sent back with the import, so a company added
  // in between is noticed instead of slipping through.
  seen: string[];
};

export const PREVIEW_ROWS = 10;

// What the person sees before importing. `mapping` null means "guess from the headers".
export function previewImport(existing: ExistingCompany[], text: string, mapping: ImportMapping | null): ActionResult<ImportPreview> {
  const table = parseCsv(text);
  if (!table.ok) return table;
  if (mapping) {
    const valid = checkMapping(mapping);
    if (!valid.ok) return valid;
  }
  const chosen = mapping ?? guessMapping(table.data.headers);
  const checked = checkRows(table.data, chosen);
  if (!checked.ok) return checked;

  const valid = checked.data.filter((r) => r.errors.length === 0);
  const groups = findGroups(existing, valid);
  const grouped = new Set(groups.flatMap((g) => g.rows));
  return {
    ok: true,
    data: {
      headers: table.data.headers,
      mapping: chosen,
      rowCount: checked.data.length,
      sample: checked.data.slice(0, PREVIEW_ROWS),
      errors: checked.data.filter((r) => r.errors.length > 0).map((r) => ({ row: r.row, messages: r.errors })),
      groups,
      labels: valid.filter((r) => grouped.has(r.row)).map((r) => ({ row: r.row, name: r.company.name, website: r.company.website })),
      defaultSkips: defaultSkips(groups),
      seen: groups.flatMap((g) => g.existing.map((c) => c.id)),
    },
  };
}

export type ImportResult = { imported: number; skipped: number; errored: number };

export type ImportPlan = {
  toImport: CheckedRow[];
  groups: DuplicateGroup[];
  result: ImportResult;
};

// Checks the choices against the file again and works out exactly what an import would add. The
// store applies the plan. `skip` is the rows the person chose to skip; `seen` is the existing
// look-alikes their preview showed.
export function planImport(existing: ExistingCompany[], text: string, mapping: ImportMapping, skip: number[], seen: string[]): ActionResult<ImportPlan> {
  const table = parseCsv(text);
  if (!table.ok) return table;
  const validMapping = checkMapping(mapping);
  if (!validMapping.ok) return validMapping;
  const checked = checkRows(table.data, mapping);
  if (!checked.ok) return checked;
  const valid = checked.data.filter((r) => r.errors.length === 0);
  const errored = checked.data.length - valid.length;

  const validRows = new Set(valid.map((r) => r.row));
  if (skip.some((row) => !validRows.has(row))) return { ok: false, error: "The import choices don't match this file. Review it again." };
  const skipped = new Set(skip);

  const groups = findGroups(existing, valid);
  const seenIds = new Set(seen);
  if (groups.some((g) => g.existing.some((c) => !seenIds.has(c.id)))) {
    return { ok: false, error: "A company that looks like rows in this file was added since your preview. Review the duplicates again." };
  }

  const toImport = valid.filter((r) => !skipped.has(r.row));
  return { ok: true, data: { toImport, groups, result: { imported: toImport.length, skipped: skipped.size, errored } } };
}
