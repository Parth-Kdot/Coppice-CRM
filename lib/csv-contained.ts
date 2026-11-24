import type { Prisma } from "@/generated/prisma/client";
import type { CheckedRow, ExistingMatch } from "@/lib/csv";
import { domainKey, lookalikePairs, nameKey } from "@/lib/duplicates";
import { CONTAINED_WHY } from "@/lib/import-review";

// Names where one is inside the other ("Avum" and "Avum Space"), which the import's exact keys
// (lib/csv.ts findGroups) miss: rows of the file against each other and against companies already
// saved. Plain code, no AI (lib/duplicates.ts lookalikePairs, the same check Smart import runs).
// Only shown for a person to decide; nothing is skipped by default, and the import's checks don't
// depend on them.

export type NameLookalike = { rows: { row: number; name: string; website: string | null }[]; existing: ExistingMatch[]; why: string };
const CONTAINED_SHOWN = 100;

export type SavedName = { id: string; name: string; website: string | null; archivedAt: Date | null; nameKey: string; domainKey: string | null };

// Every saved company's name, archived ones too. Loaded inside the preview's transaction; the
// comparing happens after it (findContained), so the transaction is never held open for it.
export function loadSavedNames(tx: Prisma.TransactionClient, workspaceId: string): Promise<SavedName[]> {
  return tx.company.findMany({
    where: { workspaceId },
    select: { id: true, name: true, website: true, archivedAt: true, nameKey: true, domainKey: true },
    orderBy: { createdAt: "asc" },
  });
}

export function findContained(rows: CheckedRow[], companies: SavedName[]): NameLookalike[] {
  if (rows.length === 0) return [];
  const items = [
    ...rows.map((r) => ({ key: `r${r.row}`, name: r.company.name, isRow: true, nameKey: nameKey(r.company.name), domainKey: domainKey(r.company.website), row: r, company: null })),
    ...companies.map((c) => ({ key: `c:${c.id}`, name: c.name, isRow: false, nameKey: c.nameKey, domainKey: c.domainKey, row: null, company: c })),
  ];
  return lookalikePairs(items, [], CONTAINED_SHOWN)
    .map(({ members }) => ({
      rows: members
        .flatMap((m) => (m.row ? [{ row: m.row.row, name: m.row.company.name, website: m.row.company.website ?? null }] : []))
        .sort((a, b) => a.row - b.row),
      existing: members.flatMap((m) => (m.company ? [{ id: m.company.id, name: m.company.name, website: m.company.website, archived: m.company.archivedAt !== null }] : [])),
      why: CONTAINED_WHY,
    }))
    .sort((a, b) => a.rows[0].row - b.rows[0].row);
}
