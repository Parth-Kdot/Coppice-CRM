import type { ExistingMatch } from "@/lib/csv";
import { IMPORT_FIELDS, type ImportField, type ImportMapping } from "@/lib/validation";

// The import's duplicate review as plain data (components/csv-importer-duplicates.tsx shows it).
// Nothing here talks to the server: every answer is still just which rows are skipped, the same
// `skip` list the import sends (lib/csv.ts runImport), so the server's checks stay the only ones
// that count.

// The reason shown for names where one is inside the other ("Avum" and "Avum Space"), found by
// code in the normal preview (lib/csv.ts) and in Smart import alike.
export const CONTAINED_WHY = "One name contains the other";

export type ReviewRow = { row: number; name: string; website: string | null };
// One reason two or more entries may be the same company: an exact group from lib/csv.ts, a
// contained name, or one of Smart import's look-alikes.
export type ReviewSource = { reason: string; existing: ExistingMatch[]; rows: ReviewRow[] };
export type ReviewGroup = { key: string; reasons: string[]; existing: ExistingMatch[]; rows: ReviewRow[] };

// Joins every source that shares a row or an existing company into one group (a union-find), so a
// row is decided in one place only. Groups come out in the order of their first row.
export function mergeGroups(sources: ReviewSource[]): ReviewGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };

  const used = sources.filter((s) => s.rows.length > 0);
  const nodesOf = (s: ReviewSource) => [...s.rows.map((r) => `r${r.row}`), ...s.existing.map((c) => `c${c.id}`)];
  for (const s of used) {
    const [first, ...rest] = nodesOf(s);
    for (const node of rest) union(first, node);
  }

  const groups = new Map<string, { reasons: string[]; existing: Map<string, ExistingMatch>; rows: Map<number, ReviewRow> }>();
  for (const s of used) {
    const root = find(nodesOf(s)[0]);
    const g = groups.get(root) ?? { reasons: [] as string[], existing: new Map<string, ExistingMatch>(), rows: new Map<number, ReviewRow>() };
    if (s.reason && !g.reasons.includes(s.reason)) g.reasons.push(s.reason);
    for (const c of s.existing) if (!g.existing.has(c.id)) g.existing.set(c.id, c);
    for (const r of s.rows) if (!g.rows.has(r.row)) g.rows.set(r.row, r);
    groups.set(root, g);
  }

  return [...groups.values()]
    .map((g) => {
      const rows = [...g.rows.values()].sort((a, b) => a.row - b.row);
      const existing = [...g.existing.values()];
      // Sorted, so the same members always make the same key whatever order the sources came in.
      const ids = existing.map((c) => c.id).sort();
      const key = `r${rows.map((r) => r.row).join("-")}${ids.length ? `_c${ids.join("-")}` : ""}`;
      return { key, reasons: g.reasons, existing, rows };
    })
    .filter((g) => g.rows.length + g.existing.length > 1)
    .sort((a, b) => a.rows[0].row - b.rows[0].row);
}

// Two rows of the file, or one row and one company already saved, are decided with one answer.
// Anything bigger is decided row by row.
export type GroupKind = "pair" | "existing" | "rows";
export function kindOf(group: ReviewGroup): GroupKind {
  if (group.rows.length === 2 && group.existing.length === 0) return "pair";
  if (group.rows.length === 1 && group.existing.length === 1) return "existing";
  return "rows";
}

// A row's name as the review says it: with its row number when another row in the group has the
// same name, so "Keep Avum only" never means two things.
export function nameIn(group: ReviewGroup, row: number): string {
  const name = group.rows.find((r) => r.row === row)?.name.trim();
  if (!name) return `Row ${row}`;
  const same = group.rows.filter((r) => r.name.trim().toLowerCase() === name.toLowerCase()).length > 1;
  return same ? `${name} (row ${row})` : name;
}

export type GroupOption = { value: string; label: string; skip: number[] };

// The single answers for a pair or an existing match; each says which of the group's rows it skips.
export function groupOptions(group: ReviewGroup): GroupOption[] {
  const kind = kindOf(group);
  if (kind === "pair") {
    const [a, b] = group.rows.map((r) => r.row);
    return [
      { value: "first", label: `Keep ${nameIn(group, a)} only`, skip: [b] },
      { value: "second", label: `Keep ${nameIn(group, b)} only`, skip: [a] },
      { value: "both", label: "Keep both, they're different companies", skip: [] },
      { value: "neither", label: "Skip both", skip: [a, b] },
    ];
  }
  if (kind === "existing") {
    const row = group.rows[0].row;
    return [
      { value: "skip", label: "Skip, it's already in Coppice", skip: [row] },
      { value: "separate", label: "Add it as a separate company", skip: [] },
    ];
  }
  return [];
}

// The answer the skips stand for now (null for a group decided row by row).
export function chosenOption(group: ReviewGroup, skips: ReadonlySet<number>): string | null {
  const options = groupOptions(group);
  const skipped = group.rows.filter((r) => skips.has(r.row)).map((r) => r.row);
  const match = options.find((o) => o.skip.length === skipped.length && o.skip.every((row) => skipped.includes(row)));
  return match?.value ?? null;
}

// What choosing an answer does: each of the group's rows, skipped or not.
export function choiceEffects(group: ReviewGroup, value: string): { row: number; skip: boolean }[] {
  const option = groupOptions(group).find((o) => o.value === value);
  if (!option) return [];
  return group.rows.map((r) => ({ row: r.row, skip: option.skip.includes(r.row) }));
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// One line under the answer: what the import will do with this group as it stands.
export function groupCaption(group: ReviewGroup, skips: ReadonlySet<number>): string {
  const kind = kindOf(group);
  const imported = group.rows.filter((r) => !skips.has(r.row)).map((r) => nameIn(group, r.row));
  const skipped = group.rows.filter((r) => skips.has(r.row)).map((r) => nameIn(group, r.row));
  // One row and the saved companies it looks like (one for the "existing" kind, or more).
  if (kind === "existing" || group.rows.length === 1) {
    const have = list(group.existing.map((c) => c.name));
    const one = group.existing.length === 1;
    return skipped.length ? `Nothing is added. ${have} ${one ? "stays as it is" : "stay as they are"}.` : `${imported[0]} is added as its own company, next to ${have}.`;
  }
  if (skipped.length === 0) return group.rows.length === 2 ? "Both are imported as separate companies." : "All of them are imported as separate companies.";
  if (imported.length === 0) return group.rows.length === 2 ? "Neither is imported." : "None of them is imported.";
  return `${list(imported)} ${imported.length === 1 ? "is" : "are"} imported. ${list(skipped)} ${skipped.length === 1 ? "is" : "are"} skipped.`;
}

// The margin note after a group is confirmed, and its line in the Decided list.
export function groupOutcome(group: ReviewGroup, skips: ReadonlySet<number>): string {
  const imported = group.rows.filter((r) => !skips.has(r.row)).map((r) => nameIn(group, r.row));
  const skipped = group.rows.filter((r) => skips.has(r.row)).map((r) => nameIn(group, r.row));
  const existing = group.existing.length > 0;
  if (skipped.length === 0) {
    if (existing) return `${list(imported)} will be added as ${imported.length === 1 ? "a separate company" : "separate companies"}.`;
    return imported.length === 2 ? `${list(imported)} will both be imported.` : `${list(imported)} will all be imported.`;
  }
  if (imported.length === 0) return existing ? `${list(skipped)} will be skipped, ${skipped.length === 1 ? "it's" : "they're"} already in Coppice.` : `${list(skipped)} will be skipped.`;
  return `${list(imported)} will be imported. ${list(skipped)} will be skipped.`;
}

export const groupsLeft = (n: number) => (n === 0 ? "That was the last group." : `${n} ${n === 1 ? "group" : "groups"} left.`);

// The groups not confirmed yet, and whether each still has its suggested answer, for the caption
// under "Import now with suggested choices".
export function unconfirmedNote(groups: ReviewGroup[], confirmed: ReadonlySet<string>, skips: ReadonlySet<number>, suggested: ReadonlySet<number>): string | null {
  const open = groups.filter((g) => !confirmed.has(g.key));
  if (open.length === 0) return null;
  const changed = openChanged(groups, confirmed, skips, suggested);
  const n = open.length;
  const groupsWord = `${n} ${n === 1 ? "group" : "groups"}`;
  return changed ? `${groupsWord} not confirmed yet ${n === 1 ? "uses" : "use"} the choice shown in ${n === 1 ? "it" : "them"}.` : `${groupsWord} not reviewed yet ${n === 1 ? "uses its" : "use their"} suggested choice.`;
}

// Whether any group not confirmed yet shows a choice other than its suggested one, so the summary's
// button can't say it imports "suggested choices" when it doesn't.
export function openChanged(groups: ReviewGroup[], confirmed: ReadonlySet<string>, skips: ReadonlySet<number>, suggested: ReadonlySet<number>): boolean {
  return groups.some((g) => !confirmed.has(g.key) && g.rows.some((r) => skips.has(r.row) !== suggested.has(r.row)));
}

// Which fields a new mapping changed, as sentences: "Smart import set Notes to "Status notes"".
const FIELD_NAMES: Record<ImportField, string> = {
  name: "Company name",
  industry: "Industry",
  website: "Website",
  notes: "Notes",
  contactName: "Contact name",
  contactEmail: "Contact email",
};
export function mappingChanges(before: ImportMapping, after: ImportMapping, headers: string[]): string[] {
  const column = (index: number | null) => (index === null ? "Not in this file" : headers[index]?.trim() || `Column ${index + 1}`);
  return IMPORT_FIELDS.filter((f) => before[f] !== after[f]).map((f) => `Smart import set ${FIELD_NAMES[f]} to "${column(after[f])}"`);
}

// Undoing what Smart import changed in the columns, without touching what the person changed by
// hand since: a field goes back only if it still holds the column Smart import gave it, and only
// if its old column isn't now used by another field (a column used twice is refused).
export function revertSmartMapping(current: ImportMapping, before: ImportMapping, after: ImportMapping): ImportMapping {
  // Indexed by field below; the name field is never null in any of the three, so none becomes null.
  const next: Record<(typeof IMPORT_FIELDS)[number], number | null> = { ...current };
  for (const f of IMPORT_FIELDS) {
    if (before[f] === after[f] || current[f] !== after[f]) continue;
    const old = before[f];
    const taken = old !== null && IMPORT_FIELDS.some((g) => g !== f && next[g] === old);
    if (!taken) next[f] = old;
  }
  return next as ImportMapping;
}
