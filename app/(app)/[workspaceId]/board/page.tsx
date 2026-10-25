import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { BoardSearch } from "@/components/board-search";
import { StageForm } from "@/components/stage-form";
import { requireMembershipOr404 } from "@/lib/authz";
import { getBoard, type BoardColumn } from "@/lib/board";
import { claimState, dbNow, type ClaimState } from "@/lib/claims";
import { listIndustries } from "@/lib/companies";
import { day } from "@/lib/dates";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { boardFiltersSchema, boardQuery, type BoardFilters } from "@/lib/validation";
import { claimCompany, moveStage, unarchiveCompany } from "../companies/actions";

type CardClaimProps = {
  state: ClaimState;
  holderName: string | null;
  expiresAt: Date | null;
  closed: boolean;
  workspaceId: string;
  companyId: string;
};

// A card's claim line: "Yours until Nov 1", "Held by Sam until Nov 1", or a Claim button.
// Committed and Declined companies can't be claimed, so they show nothing.
function CardClaim({ state, holderName, expiresAt, closed, workspaceId, companyId }: CardClaimProps) {
  if (state === "mine") return <span className="text-sm text-green-700">Yours until {day(expiresAt as Date)}</span>;
  if (state === "theirs") return <span className="text-sm">Held by {holderName} until {day(expiresAt as Date)}</span>;
  if (closed) return null;
  return (
    <ActionForm action={claimCompany} submitLabel="Claim">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
    </ActionForm>
  );
}

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
  });

  // The time comes from the database, the same clock the claim SQL uses, for "overdue" and claims.
  const [board, industries, now] = await Promise.all([getBoard(tenant, filters), listIndustries(tenant), dbNow()]);
  const href = (changes: Partial<BoardFilters>) => `/${workspaceId}/board${boardQuery({ ...filters, ...changes })}`;
  const filtered = filters.q !== "" || filters.industry !== "";
  const total = board.columns.reduce((sum, column) => sum + column.count, 0);

  const toggle = (column: BoardColumn) =>
    href({ show: column.open ? filters.show.filter((s) => s !== column.stage) : [...filters.show, column.stage] });

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Board</h1>
        <div className="flex gap-2">
          <Link href={`/${workspaceId}/companies/new`} className="rounded border px-3 py-1">
            Add company
          </Link>
          <Link href={`/${workspaceId}`} className="rounded border px-3 py-1">
            Back
          </Link>
        </div>
      </header>

      <BoardSearch filters={filters} industries={industries} />

      {total === 0 && (
        <p className="text-sm text-zinc-500">{filtered ? "No companies match." : "No companies yet. Add your first one."}</p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:overflow-x-auto">
        {board.columns.map((column) => (
          <section key={column.stage} className="flex shrink-0 flex-col gap-2 sm:w-64">
            <h2 className="font-semibold">
              {TERMINAL_STAGES.includes(column.stage) ? (
                <Link href={toggle(column)} scroll={false} aria-expanded={column.open}>
                  {column.open ? "▾" : "▸"} {STAGE_LABELS[column.stage]} ({column.count})
                </Link>
              ) : (
                `${STAGE_LABELS[column.stage]} (${column.count})`
              )}
            </h2>
            {column.open && (
              <ul className="flex flex-col gap-2">
                {column.cards.map((card) => (
                  <li key={card.id} className="flex flex-col gap-1 rounded border p-2">
                    <Link href={`/${workspaceId}/companies/${card.id}`} className="font-medium underline">
                      {card.name}
                    </Link>
                    {card.industry && <span className="text-sm text-zinc-500">{card.industry}</span>}
                    <span className="text-sm">
                      {card.nextFollowUpAt ? (
                        <>
                          Follow up {day(card.nextFollowUpAt)}
                          {card.nextFollowUpAt < now && <span className="text-red-600"> (overdue)</span>}
                        </>
                      ) : (
                        <span className="text-zinc-500">No follow-up set</span>
                      )}
                    </span>
                    <CardClaim
                      state={claimState(card, now, userId)}
                      holderName={card.claimedBy?.name ?? null}
                      expiresAt={card.claimExpiresAt}
                      closed={TERMINAL_STAGES.includes(card.stage)}
                      workspaceId={workspaceId}
                      companyId={card.id}
                    />
                    <StageForm compact workspaceId={workspaceId} companyId={card.id} stage={card.stage} action={moveStage} />
                  </li>
                ))}
              </ul>
            )}
            {column.hasMore && (
              <Link href={href({ all: column.stage })} scroll={false} className="text-sm underline">
                Show all {column.count}
              </Link>
            )}
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">
          <Link href={href({ archived: !filters.archived })} scroll={false} aria-expanded={filters.archived}>
            {filters.archived ? "▾" : "▸"} Archived ({board.archivedCount})
          </Link>
        </h2>
        {board.archived && (
          <ul className="flex flex-col gap-2">
            {board.archived.map((company) => (
              <li key={company.id} className="flex flex-wrap items-center gap-3">
                <Link href={`/${workspaceId}/companies/${company.id}`} className="underline">
                  {company.name}
                </Link>
                {company.industry && <span className="text-sm text-zinc-500">{company.industry}</span>}
                <ActionForm action={unarchiveCompany} submitLabel="Unarchive">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="companyId" value={company.id} />
                  <input type="hidden" name="stay" value="board" />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
