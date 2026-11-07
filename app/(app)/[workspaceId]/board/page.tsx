import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { BoardSheet } from "@/components/ledger/board-sheet";
import type { BoardCardData } from "@/components/ledger/board-slip";
import { BoardView, type BoardColumnData } from "@/components/ledger/board-view";
import { DuplicatePairs } from "@/components/ledger/duplicate-pairs";
import { requireMembershipOr404 } from "@/lib/authz";
import { getBoard } from "@/lib/board";
import { claimState, dbNow } from "@/lib/claims";
import { DUPLICATE_PAIR_LIMIT, listIndustries, listPossibleDuplicatePairs } from "@/lib/companies";
import { daysBetween, day } from "@/lib/dates";
import { TERMINAL_STAGES } from "@/lib/stages";
import { boardFiltersSchema, boardQuery, type BoardFilters } from "@/lib/validation";
import { unarchiveCompany } from "../companies/actions";
import { pageTitle } from "../page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]/board">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Board");
}

// The stage board: one ruled column per stage, fitted to the screen. Search, the industry filter, the
// sheets for look-alikes and archived companies, and "Show all" are decided on the server from the
// URL. Committed and Declined always show, split in one column, so the board reads in a single view.
export default async function BoardPage({ params, searchParams }: PageProps<"/[workspaceId]/board">) {
  const { workspaceId } = await params;
  const { userId } = await requireMembershipOr404(workspaceId);
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

  // The time comes from the database, the same clock the claim SQL uses, for "overdue" and claims.
  const [board, industries, now, pairs] = await Promise.all([
    getBoard(tenant, { ...filters, show: TERMINAL_STAGES }),
    listIndustries(tenant),
    dbNow(),
    listPossibleDuplicatePairs(tenant, DUPLICATE_PAIR_LIMIT),
  ]);
  const href = (changes: Partial<BoardFilters>) => `/${workspaceId}/board${boardQuery({ ...filters, ...changes })}`;
  const filtered = filters.q !== "" || filters.industry !== "";
  const total = board.columns.reduce((sum, column) => sum + column.count, 0);

  const columns: BoardColumnData[] = board.columns.map((column) => ({
    stage: column.stage,
    count: column.count,
    hasMore: column.hasMore,
    showAllHref: href({ all: column.stage }),
    cards: column.cards.map(
      (card): BoardCardData => ({
        id: card.id,
        name: card.name,
        industry: card.industry,
        stage: card.stage,
        days: card.nextFollowUpAt ? daysBetween(card.nextFollowUpAt, now) : null,
        dueOn: card.nextFollowUpAt ? day(card.nextFollowUpAt) : null,
        closed: TERMINAL_STAGES.includes(card.stage),
        claim: {
          state: claimState(card, now, userId),
          holderName: card.claimedBy?.name ?? null,
          until: card.claimExpiresAt ? day(card.claimExpiresAt) : null,
        },
      }),
    ),
  }));

  const duplicateLabel = pairs.length === DUPLICATE_PAIR_LIMIT ? `${DUPLICATE_PAIR_LIMIT}+` : String(pairs.length);
  const closeHref = (key: "dupes" | "archived") => href({ [key]: false });

  return (
    <>
      <BoardView
        workspaceId={workspaceId}
        columns={columns}
        filters={filters}
        industries={industries}
        total={total}
        filtered={filtered}
        duplicateLabel={duplicateLabel}
        archivedCount={board.archivedCount}
        dupesHref={filters.dupes ? closeHref("dupes") : href({ dupes: true, archived: false })}
        archivedHref={filters.archived ? closeHref("archived") : href({ archived: true, dupes: false })}
        dupesOpen={filters.dupes}
        archivedOpen={filters.archived}
      />

      {filters.dupes && (
        <BoardSheet title="Possible duplicates" count={duplicateLabel} closeHref={closeHref("dupes")}>
          <p className="lg-hint">
            Companies that look alike (same name ignoring case and Inc/LLC/Corp, or same website). Archive the copy, or keep both as separate entries so they stop
            being flagged.
          </p>
          <DuplicatePairs
            workspaceId={workspaceId}
            more={pairs.length === DUPLICATE_PAIR_LIMIT}
            pairs={pairs.map(({ a, b, matchedOn }) => ({
              key: `${a.id}|${b.id}`,
              a: { id: a.id, name: a.name, website: a.website },
              b: { id: b.id, name: b.name, website: b.website },
              matchedOn,
            }))}
          />
        </BoardSheet>
      )}

      {filters.archived && (
        <BoardSheet title="Archived" count={board.archivedCount} closeHref={closeHref("archived")}>
          {board.archived === null ? (
            <p className="lg-muted py-4">Nothing is archived.</p>
          ) : (
            <ul className="lg-archived">
              {board.archived.map((company) => (
                <li key={company.id}>
                  <span>
                    <Link href={`/${workspaceId}/companies/${company.id}`} className="lg-link font-semibold">
                      {company.name}
                    </Link>
                    {company.industry && <span className="lg-muted">, {company.industry}</span>}
                  </span>
                  <ActionForm action={unarchiveCompany} submitLabel="Unarchive">
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="companyId" value={company.id} />
                    <input type="hidden" name="stay" value="board" />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </BoardSheet>
      )}
    </>
  );
}
