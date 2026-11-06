import type { Stage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { withTenant, type Tenant } from "@/lib/db";
import { STAGES, TERMINAL_STAGES } from "@/lib/stages";
import type { BoardFilters } from "@/lib/validation";

// The stage board. A fixed number of queries per load however many companies there are: one
// count per stage (a single GROUP BY), one query per open column, and the archived count. Cards
// select only what they show. Runs inside withTenant, so row-level security applies too.

export const COLUMN_SIZE = 50;
// "Show all" and the archived list stop here: the most one CSV import can add (Milestone 4).
export const SHOW_ALL_LIMIT = 2000;

// The claim fields are read only, to show "Held by Sam until Nov 1"; whether a claim is still live
// is decided against the database clock (dbNow in lib/claims.ts).
const CARD = {
  id: true,
  name: true,
  industry: true,
  stage: true,
  nextFollowUpAt: true,
  claimedById: true,
  claimExpiresAt: true,
  claimedBy: { select: { name: true } },
} as const;

export type BoardCard = Prisma.CompanyGetPayload<{ select: typeof CARD }>;
export type BoardColumn = { stage: Stage; count: number; open: boolean; cards: BoardCard[]; hasMore: boolean };
export type ArchivedCompany = { id: string; name: string; industry: string | null };
export type Board = { columns: BoardColumn[]; archivedCount: number; archived: ArchivedCompany[] | null };

// Postgres treats % and _ in a LIKE pattern as wildcards; a search for "100%" means the text.
export const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function getBoard(tenant: Tenant, filters: BoardFilters): Promise<Board> {
  return withTenant(tenant, async (tx) => {
    const matching: Prisma.CompanyWhereInput = {
      workspaceId: tenant.workspaceId,
      ...(filters.q ? { name: { contains: literal(filters.q), mode: "insensitive" } } : {}),
      ...(filters.industry ? { industry: filters.industry } : {}),
    };
    const active = { ...matching, archivedAt: null };

    const grouped = await tx.company.groupBy({ by: ["stage"], where: active, _count: { _all: true } });
    const counts = new Map(grouped.map((g) => [g.stage, g._count._all]));

    const columns: BoardColumn[] = [];
    for (const stage of STAGES) {
      const count = counts.get(stage) ?? 0;
      const open = !TERMINAL_STAGES.includes(stage) || filters.show.includes(stage);
      if (!open || count === 0) {
        columns.push({ stage, count, open, cards: [], hasMore: false });
        continue;
      }
      const limit = filters.all === stage ? SHOW_ALL_LIMIT : COLUMN_SIZE;
      // One extra row tells us whether there are more than `limit`, without a second count.
      const rows = await tx.company.findMany({
        where: { ...active, stage },
        select: CARD,
        // Soonest follow-up first, companies without one last, then by name. Matches the
        // (workspaceId, stage, nextFollowUpAt) index, so Postgres reads rows already in order.
        orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      columns.push({ stage, count, open, cards: rows.slice(0, limit), hasMore: rows.length > limit });
    }

    const archivedWhere = { ...matching, archivedAt: { not: null } };
    const archivedCount = await tx.company.count({ where: archivedWhere });
    const archived =
      filters.archived && archivedCount > 0
        ? await tx.company.findMany({
            where: archivedWhere,
            select: { id: true, name: true, industry: true },
            orderBy: { archivedAt: "desc" },
            take: SHOW_ALL_LIMIT,
          })
        : null;

    return { columns, archivedCount, archived };
  });
}
