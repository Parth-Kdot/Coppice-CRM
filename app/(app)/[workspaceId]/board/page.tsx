import type { Metadata } from "next";
import { ArchivedList, BoardSheet } from "@/components/ledger/board-sheet";
import type { BoardCardData } from "@/components/ledger/board-slip";
import { BoardView, type BoardColumnData } from "@/components/ledger/board-view";
import { DuplicatePairs } from "@/components/ledger/duplicate-pairs";
import { Disclosure } from "@/components/ledger/disclosure";
import { requireMembershipOr404 } from "@/lib/authz";
import { ARCHIVED_PAGE, COLUMN_CAP, COLUMN_STEP, getBoard, parseBoardPaging, withPaging, type BoardPaging } from "@/lib/board";
import { claimState, dbNow } from "@/lib/claims";
import { listIndustries } from "@/lib/companies";
import { countPossibleDuplicates, DUPLICATE_PAIR_LIMIT, listDuplicateReview } from "@/lib/company-pairs";
import { daysBetween, day } from "@/lib/dates";
import { TERMINAL_STAGES } from "@/lib/stages";
import { boardFiltersSchema, boardQuery, type BoardFilters } from "@/lib/validation";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/board">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Board");
}

// The stage board: one ruled column per stage, fitted to the screen. Search, the industry filter,
// each column's "Show 50 more", and the sheets for look-alikes and archived companies are decided
// on the server from the URL. Committed and Declined always show, split in one column, so the board
// reads in a single view. Look-alike pairs are only built when their sheet is open; otherwise the
// More menu's badge comes from a capped count.
export default async function BoardPage({ params, searchParams }: PageProps<"/[workspaceId]/board">) {
  const { workspaceId } = await params;
  const { userId, role } = await requireMembershipOr404(workspaceId);
  const tenant = { userId, workspaceId };

  // A repeated URL param (?q=a&q=b) arrives as an array; use the first.
  const raw = await searchParams;
  const first = (key: string) => [raw[key]].flat()[0] ?? null;
  const filters = boardFiltersSchema.parse({
    q: first("q"),
    industry: first("industry"),
    show: first("show"),
    all: first("all"),
    archived: first("archived"),
    dupes: first("dupes"),
  });
  const paging = parseBoardPaging({ more: first("more"), moved: first("moved"), aupto: first("aupto"), aq: first("aq") });

  // The time comes from the database, the same clock the claim SQL uses, for "overdue" and claims.
  // Separate transactions, so they may run side by side.
  const [board, industries, now, pairs, pairCount] = await Promise.all([
    getBoard(tenant, { ...filters, show: TERMINAL_STAGES }, paging),
    listIndustries(tenant),
    dbNow(),
    filters.dupes ? listDuplicateReview(tenant, DUPLICATE_PAIR_LIMIT) : null,
    filters.dupes ? null : countPossibleDuplicates(tenant),
  ]);

  const base = `/${workspaceId}/board`;
  const href = (changes: Partial<BoardFilters>, page: Partial<BoardPaging> = {}) =>
    `${base}${withPaging(boardQuery({ ...filters, ...changes }), { ...paging, moved: null, ...page })}`;
  const filtered = filters.q !== "" || filters.industry !== "";
  const total = board.columns.reduce((sum, column) => sum + column.count, 0);

  const columns: BoardColumnData[] = board.columns.map((column) => ({
    stage: column.stage,
    count: column.count,
    // How many cards of the page are loaded (a pinned, just-moved card is extra).
    shown: Math.min(column.count, column.shown),
    moreHref: href({ all: null }, { more: { ...paging.more, [column.stage]: Math.min(COLUMN_CAP, column.shown + COLUMN_STEP) } }),
    cards: column.cards.map((card): BoardCardData => ({
      id: card.id,
      name: card.name,
      industry: card.industry,
      stage: card.stage,
      days: card.nextFollowUpAt ? daysBetween(card.nextFollowUpAt, now) : null,
      dueOn: card.nextFollowUpAt ? day(card.nextFollowUpAt) : null,
      closed: TERMINAL_STAGES.includes(card.stage),
      justMoved: card.id === column.pinned,
      claim: {
        state: claimState(card, now, userId),
        holderName: card.claimedBy?.name ?? null,
        until: card.claimExpiresAt ? day(card.claimExpiresAt) : null,
      },
    })),
  }));

  const pairTotal = pairs ? pairs.length : (pairCount ?? 0);
  const atCap = pairTotal >= DUPLICATE_PAIR_LIMIT;
  const duplicateLabel = atCap ? `${DUPLICATE_PAIR_LIMIT}+` : pairTotal.toLocaleString("en-US");
  const closeHref = (key: "dupes" | "archived") => href({ [key]: false }, key === "archived" ? { archivedUpto: ARCHIVED_PAGE, archivedQ: "" } : {});

  return (
    <>
      <BoardView
        workspaceId={workspaceId}
        isOwner={role === "owner"}
        columns={columns}
        filters={filters}
        industries={industries}
        total={total}
        workspaceTotal={board.workspaceTotal}
        filtered={filtered}
        duplicateCount={pairTotal}
        duplicateLabel={duplicateLabel}
        archivedCount={board.archivedCount}
        dupesHref={href({ dupes: true, archived: false })}
        archivedHref={href({ archived: true, dupes: false })}
      />

      {filters.dupes && (
        <BoardSheet title="Possible duplicates" count={duplicateLabel} closeHref={closeHref("dupes")}>
          <p className="lg-hint">Companies that may be the same one entered twice.</p>
          <Disclosure variant="inline" summary="Why these?">
            <p className="lg-hint">
              Two companies are listed when their names match once case and endings like Inc, LLC or Corp are ignored, or when their websites match. Pick
              &ldquo;Same company&rdquo; to archive the copy (you can unarchive it later), or &ldquo;Different companies&rdquo; so the pair stops being listed.
            </p>
          </Disclosure>
          <DuplicatePairs
            workspaceId={workspaceId}
            more={atCap}
            pairs={(pairs ?? []).map(({ a, b, matchedOn, keepId }) => ({
              key: `${a.id}|${b.id}`,
              a: { id: a.id, name: a.name, website: a.website },
              b: { id: b.id, name: b.name, website: b.website },
              matchedOn,
              keepId,
            }))}
          />
        </BoardSheet>
      )}

      {filters.archived && (
        <BoardSheet title="Archived" count={board.archivedCount.toLocaleString("en-US")} closeHref={closeHref("archived")}>
          {board.archived === null ? (
            <p className="lg-muted py-4">Nothing is archived.</p>
          ) : (
            <ArchivedList
              workspaceId={workspaceId}
              companies={board.archived}
              total={board.archivedCount}
              matching={board.archivedMatching}
              query={paging.archivedQ}
              moreHref={href({}, { archivedUpto: Math.min(COLUMN_CAP, paging.archivedUpto + ARCHIVED_PAGE) })}
              filterHref={href({}, { archivedQ: "", archivedUpto: ARCHIVED_PAGE })}
            />
          )}
        </BoardSheet>
      )}
    </>
  );
}
