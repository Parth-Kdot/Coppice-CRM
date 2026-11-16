import type { Stage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { withTenant, type Tenant } from "@/lib/db";
import { STAGES, TERMINAL_STAGES } from "@/lib/stages";
import type { BoardFilters } from "@/lib/validation";

// The stage board. A fixed number of queries per load however many companies there are: one
// count per stage (a single GROUP BY), one query per open column, the archived count, and at most
// three small extras (the unfiltered total when a filter is on, a just-moved company, the archived
// page). Cards select only what they show. Runs inside withTenant, so row-level security applies.

// Each column shows this many cards, then "Show 50 more" (COLUMN_STEP) up to COLUMN_CAP. Past the
// cap, search or the industry filter narrows the board instead.
export const COLUMN_SIZE = 50;
export const COLUMN_STEP = 50;
export const COLUMN_CAP = 200;
// The archived sheet pages the same way.
export const ARCHIVED_PAGE = 50;
// The size of the workspace the board's load test seeds: as many companies as one CSV import can add.
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
// `pinned`: the id of a card shown at the top of the column although it sorts past the cards
// loaded (a company just moved here, ?moved=). `shown` is how many cards the column asked for.
export type BoardColumn = { stage: Stage; count: number; open: boolean; cards: BoardCard[]; hasMore: boolean; shown: number; pinned: string | null };
export type ArchivedCompany = { id: string; name: string; industry: string | null };
export type Board = {
  columns: BoardColumn[];
  // Active companies in the whole workspace, ignoring search and the industry filter.
  workspaceTotal: number;
  archivedCount: number;
  // Archived companies matching the archived sheet's own filter (aq), for its "Show 50 more".
  archivedMatching: number;
  archived: ArchivedCompany[] | null;
};

// The board's paging, from the URL, next to the filters lib/validation.ts reads:
//   more=CONTACTED:100,REPLIED:150  how many cards each of those columns shows (50 steps, at most 200)
//   moved=<id>                      a company just moved: shown in its new column even past the page
//   aupto=100                       how many archived companies the archived sheet lists
//   aq=acme                         the archived sheet's own filter box
export type BoardPaging = { more: Partial<Record<Stage, number>>; moved: string | null; archivedUpto: number; archivedQ: string };
export const NO_PAGING: BoardPaging = { more: {}, moved: null, archivedUpto: ARCHIVED_PAGE, archivedQ: "" };

// A page size from the URL: a whole number of steps between one step and the cap. Anything else is
// dropped (a URL can be typed or edited by hand), so the page never fails on it.
function pageSize(raw: string | undefined, step: number, cap: number): number | null {
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (n < step) return null;
  return Math.min(cap, Math.floor(n / step) * step);
}

const isStage = (value: string): value is Stage => (STAGES as string[]).includes(value);

export function parseBoardPaging(raw: { more?: string | null; moved?: string | null; aupto?: string | null; aq?: string | null }): BoardPaging {
  const more: Partial<Record<Stage, number>> = {};
  for (const part of (raw.more ?? "").split(",").slice(0, STAGES.length)) {
    const [stage, n] = part.split(":");
    const size = pageSize(n, COLUMN_STEP, COLUMN_CAP);
    if (stage && isStage(stage) && size !== null && size > COLUMN_SIZE) more[stage] = size;
  }
  const moved = raw.moved && /^[\w-]{1,64}$/.test(raw.moved) ? raw.moved : null;
  const archivedUpto = pageSize(raw.aupto ?? undefined, ARCHIVED_PAGE, COLUMN_CAP) ?? ARCHIVED_PAGE;
  const archivedQ = (raw.aq ?? "").trim().slice(0, 100);
  return { more, moved, archivedUpto, archivedQ };
}

// The paging's part of a board URL, as "key=value" pairs to add after boardQuery's.
export function pagingParams(paging: BoardPaging): [string, string][] {
  const out: [string, string][] = [];
  const more = STAGES.filter((s) => (paging.more[s] ?? 0) > COLUMN_SIZE).map((s) => `${s}:${paging.more[s]}`);
  if (more.length > 0) out.push(["more", more.join(",")]);
  if (paging.moved) out.push(["moved", paging.moved]);
  if (paging.archivedUpto > ARCHIVED_PAGE) out.push(["aupto", String(paging.archivedUpto)]);
  if (paging.archivedQ) out.push(["aq", paging.archivedQ]);
  return out;
}

// A board query string ("?q=acme&more=CONTACTED%3A100"), from boardQuery's string plus the paging.
export function withPaging(query: string, paging: BoardPaging): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of pagingParams(paging)) params.set(key, value);
  const out = params.toString();
  return out ? `?${out}` : "";
}

// Postgres treats % and _ in a LIKE pattern as wildcards; a search for "100%" means the text.
export const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function getBoard(tenant: Tenant, filters: BoardFilters, paging: BoardPaging = NO_PAGING): Promise<Board> {
  return withTenant(tenant, async (tx) => {
    const matching: Prisma.CompanyWhereInput = {
      workspaceId: tenant.workspaceId,
      ...(filters.q ? { name: { contains: literal(filters.q), mode: "insensitive" } } : {}),
      ...(filters.industry ? { industry: filters.industry } : {}),
    };
    const active = { ...matching, archivedAt: null };

    const grouped = await tx.company.groupBy({ by: ["stage"], where: active, _count: { _all: true } });
    const counts = new Map(grouped.map((g) => [g.stage, g._count._all]));

    // A company just moved, if it still matches the board's search and filter.
    const moved = paging.moved ? await tx.company.findFirst({ where: { ...active, id: paging.moved }, select: CARD }) : null;

    const columns: BoardColumn[] = [];
    for (const stage of STAGES) {
      const count = counts.get(stage) ?? 0;
      const open = !TERMINAL_STAGES.includes(stage) || filters.show.includes(stage);
      // ?all=<stage> is an old "Show all" link: it now opens that column to the cap.
      const limit = filters.all === stage ? COLUMN_CAP : Math.min(COLUMN_CAP, Math.max(COLUMN_SIZE, paging.more[stage] ?? COLUMN_SIZE));
      if (!open || count === 0) {
        columns.push({ stage, count, open, cards: [], hasMore: false, shown: limit, pinned: null });
        continue;
      }
      // One extra row tells us whether there are more than `limit`, without a second count.
      const rows = await tx.company.findMany({
        where: { ...active, stage },
        select: CARD,
        // Soonest follow-up first, companies without one last, then by name. Matches the
        // (workspaceId, stage, nextFollowUpAt) index, so Postgres reads rows already in order.
        orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      const cards = rows.slice(0, limit);
      // The moved company sorts past this page: show it anyway, at the top, so it never vanishes.
      const pin = moved && moved.stage === stage && !cards.some((c) => c.id === moved.id) ? moved : null;
      columns.push({ stage, count, open, cards: pin ? [pin, ...cards] : cards, hasMore: rows.length > limit, shown: limit, pinned: pin?.id ?? null });
    }

    const filtered = filters.q !== "" || filters.industry !== "";
    const workspaceTotal = filtered
      ? await tx.company.count({ where: { workspaceId: tenant.workspaceId, archivedAt: null } })
      : [...counts.values()].reduce((sum, n) => sum + n, 0);

    const archivedWhere = { ...matching, archivedAt: { not: null } };
    const archivedCount = await tx.company.count({ where: archivedWhere });
    let archived: ArchivedCompany[] | null = null;
    let archivedMatching = archivedCount;
    if (filters.archived && archivedCount > 0) {
      const sheetWhere: Prisma.CompanyWhereInput = paging.archivedQ
        ? {
            ...archivedWhere,
            name: { contains: literal(paging.archivedQ), mode: "insensitive" },
            ...(filters.q ? { AND: [{ name: { contains: literal(filters.q), mode: "insensitive" } }] } : {}),
          }
        : archivedWhere;
      if (paging.archivedQ) archivedMatching = await tx.company.count({ where: sheetWhere });
      archived = await tx.company.findMany({
        where: sheetWhere,
        select: { id: true, name: true, industry: true },
        orderBy: [{ archivedAt: "desc" }, { id: "asc" }],
        take: Math.min(COLUMN_CAP, Math.max(ARCHIVED_PAGE, paging.archivedUpto)),
      });
    }

    return { columns, workspaceTotal, archivedCount, archivedMatching, archived };
  });
}
