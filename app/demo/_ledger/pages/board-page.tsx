"use client";
import "@/components/ledger/zod-jitless";

import Link from "next/link";
import { ActionForm } from "@/components/ledger/action-form";
import { BoardSheet } from "@/components/ledger/board-sheet";
import type { BoardCardData } from "@/components/ledger/board-slip";
import { BoardView, type BoardColumnData } from "@/components/ledger/board-view";
import { DuplicateIcon } from "@/components/ledger/icons";
import { day, daysBetween } from "@/lib/dates";
import { TERMINAL_STAGES } from "@/lib/stages";
import { boardQuery, type BoardFilters as RealFilters } from "@/lib/validation";
import { useBoard, useBoardFilters, useDemoState } from "@/demo/store";
import { DUPLICATE_PAIR_LIMIT } from "@/demo/validation";
import { claimData } from "../view";
import { useFormActions } from "../form-actions";

// The board, drawn as the real one is, from the in-browser store. Committed and Declined always show.
export function BoardPage({ ws }: { ws: string }) {
  const filters = useBoardFilters();
  const board = useBoard(ws, { ...filters, show: [...TERMINAL_STAGES] as typeof filters.show });
  const { now } = useDemoState();
  const a = useFormActions();
  const nowDate = new Date(now);
  const real: RealFilters = { q: filters.q, industry: filters.industry, show: [], all: filters.all, archived: filters.archived, dupes: filters.dupes } as RealFilters;
  const href = (changes: Partial<RealFilters>) => `/demo/w/${ws}/board${boardQuery({ ...real, ...changes })}`;
  const filtered = filters.q !== "" || filters.industry !== "";
  const pairs = board.duplicatePairs;

  const columns: BoardColumnData[] = board.columns.map((column) => ({
    stage: column.stage,
    count: column.count,
    hasMore: column.hasMore,
    showAllHref: href({ all: column.stage }),
    cards: column.cards.map(
      (card): BoardCardData => ({
        id: card.company.id,
        name: card.company.name,
        industry: card.company.industry,
        stage: card.company.stage,
        days: card.company.nextFollowUpAt ? daysBetween(new Date(card.company.nextFollowUpAt), nowDate) : null,
        dueOn: card.company.nextFollowUpAt ? day(new Date(card.company.nextFollowUpAt)) : null,
        closed: card.closed,
        claim: claimData(card.claim),
      }),
    ),
  }));

  const duplicateLabel = pairs.length >= DUPLICATE_PAIR_LIMIT ? `${DUPLICATE_PAIR_LIMIT}+` : String(pairs.length);
  const closeHref = (key: "dupes" | "archived") => href({ [key]: false });

  return (
    <>
      <BoardView
        workspaceId={ws}
        columns={columns}
        filters={real}
        industries={board.industries}
        total={board.total}
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
          {pairs.length === 0 ? (
            <p className="lg-muted py-4">No look-alike pairs right now.</p>
          ) : (
            <ul className="lg-pairs">
              {pairs.map(({ a: pa, b: pb, matchedOn }) => (
                <li key={`${pa.id}|${pb.id}`} className="lg-pair">
                  <p className="lg-pair-names">
                    <Link href={`/demo/w/${ws}/companies/${pa.id}`} className="lg-link">
                      {pa.name}
                    </Link>
                    <span aria-hidden="true">and</span>
                    <Link href={`/demo/w/${ws}/companies/${pb.id}`} className="lg-link">
                      {pb.name}
                    </Link>
                  </p>
                  <p className="lg-pair-site">{[pa.website, pb.website].filter(Boolean).join(" and ") || "No website on either"}</p>
                  <p className="lg-pair-why">
                    <DuplicateIcon size={16} /> Same {matchedOn.join(" and ")}.
                  </p>
                  <div className="lg-actions">
                    {[
                      [pb, pa],
                      [pa, pb],
                    ].map(([keep, drop]) => (
                      <ActionForm
                        key={drop.id}
                        action={a.archiveDuplicate}
                        submitLabel={`Same company: archive ${drop.name}`}
                        confirmMessage={`Archive ${drop.name} and keep ${keep.name}? You can unarchive it later.`}
                      >
                        <input type="hidden" name="workspaceId" value={ws} />
                        <input type="hidden" name="keepId" value={keep.id} />
                        <input type="hidden" name="archiveId" value={drop.id} />
                      </ActionForm>
                    ))}
                    <ActionForm action={a.keepSeparate} submitLabel="Separate entries">
                      <input type="hidden" name="workspaceId" value={ws} />
                      <input type="hidden" name="companyId" value={pa.id} />
                      <input type="hidden" name="otherId" value={pb.id} />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
                    <Link href={`/demo/w/${ws}/companies/${company.id}`} className="lg-link font-semibold">
                      {company.name}
                    </Link>
                    {company.industry && <span className="lg-muted">, {company.industry}</span>}
                  </span>
                  <ActionForm action={a.unarchiveCompany} submitLabel="Unarchive">
                    <input type="hidden" name="workspaceId" value={ws} />
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
