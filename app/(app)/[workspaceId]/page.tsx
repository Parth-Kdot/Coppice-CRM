import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/ledger/icons";
import { QueueRow, type QueueRowData } from "@/components/ledger/queue-row";
import { Count, Empty, PageHead } from "@/components/ledger/shared";
import { requireMembershipOr404, roleLabel } from "@/lib/authz";
import { claimState, heldBy } from "@/lib/claims";
import { daysBetween, day } from "@/lib/dates";
import { withTenant } from "@/lib/db";
import { getQueue, type QueueRow as QueueRecord } from "@/lib/queue";
import { TERMINAL_STAGES } from "@/lib/stages";
import { queueFiltersSchema, queueQuery, type QueueFilters } from "@/lib/validation";

// Workspace home: the follow-up queue. Due companies, most overdue first, then a collapsed list of
// fresh leads. Everything is decided on the server from the URL, like the board. The totals line
// above the table counts all due companies and the ones you hold, whatever the filter shows.
export default async function QueuePage({ params, searchParams }: PageProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const membership = await requireMembershipOr404(workspaceId);
  const { userId } = membership;

  const raw = await searchParams;
  const first = (key: string) => [raw[key]].flat()[0] ?? null;
  const filters = queueFiltersSchema.parse({ mine: first("mine"), never: first("never"), all: first("all") });

  const queue = await getQueue({ userId, workspaceId }, filters);

  // The two totals the filter would hide: every due company, and the due ones you hold. Same
  // definition of "due" as the queue itself (open stage, follow-up date reached).
  const totals = await withTenant({ userId, workspaceId }, async (tx) => {
    const due = { workspaceId, archivedAt: null, stage: { notIn: TERMINAL_STAGES }, nextFollowUpAt: { lte: queue.now } };
    const all = await tx.company.count({ where: due });
    const mine = await tx.company.count({ where: { ...due, ...heldBy(userId, queue.now) } });
    const oldest = await tx.company.findFirst({ where: due, orderBy: { nextFollowUpAt: "asc" }, select: { nextFollowUpAt: true } });
    return { all, mine, oldest: oldest?.nextFollowUpAt ?? null };
  });

  const href = (changes: Partial<QueueFilters>) => `/${workspaceId}${queueQuery({ ...filters, ...changes })}`;

  const toRow = (row: QueueRecord): QueueRowData => {
    const state = claimState(row, queue.now, userId);
    return {
      id: row.id,
      name: row.name,
      days: row.nextFollowUpAt ? daysBetween(row.nextFollowUpAt, queue.now) : null,
      dueOn: row.nextFollowUpAt ? day(row.nextFollowUpAt) : null,
      note: row.lastNote,
      claim: {
        state,
        holderName: row.claimedBy?.name ?? null,
        until: row.claimExpiresAt ? day(row.claimExpiresAt) : null,
      },
    };
  };

  // The longest wait is the oldest follow-up date among all due companies, so the Held by you filter does not change it.
  const longest = totals.oldest ? Math.max(0, daysBetween(totals.oldest, queue.now)) : 0;

  const title = filters.mine ? "Yours, due" : "Follow-ups due";

  return (
    <div className="lg-queue">
      <PageHead title={title} count={queue.dueCount} sub={`You are an ${roleLabel(membership.role).toLowerCase()} here.`}>
        <Link href={`/${workspaceId}/import`} className="lg-btn">
          Import
        </Link>
        <Link href={`/${workspaceId}/companies/new`} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          Add company
        </Link>
      </PageHead>

      <nav className="lg-totals" aria-label="Queue totals">
        <Link href={href({ mine: false, all: null })} className="lg-total" aria-current={!filters.mine ? "true" : undefined}>
          <span className="lg-tag">All due</span>
          <span className="lg-total-n">
            <Count value={totals.all} />
          </span>
        </Link>
        <Link href={href({ mine: true, all: null })} className="lg-total" aria-current={filters.mine ? "true" : undefined}>
          <span className="lg-tag">Held by you</span>
          <span className="lg-total-n">
            <Count value={totals.mine} />
          </span>
        </Link>
        <Link href={href({ never: true, all: null }) + "#never-title"} aria-current={filters.never ? "true" : undefined} className="lg-total">
          <span className="lg-tag">Never contacted</span>
          <span className="lg-total-n">
            <Count value={queue.neverCount} />
          </span>
        </Link>
        <div className="lg-total">
          <span className="lg-tag">Longest wait</span>
          <span className="lg-total-n" data-rust={longest >= 7 || undefined}>
            <Count value={longest} /> <span className="lg-total-unit">{longest === 1 ? "day" : "days"}</span>
          </span>
        </div>
      </nav>

      <div className="lg-qtable">
        <div className="lg-qhead lg-sc" aria-hidden="true">
          <span>When</span>
          <span>Company</span>
          <span className="lg-qnote">Last note</span>
          <span>Claim</span>
          <span />
        </div>

        {queue.due.length === 0 ? (
          <Empty kind={filters.mine ? "queue-mine" : "queue-due"}>
            <p className="lg-empty-title">{filters.mine ? "Nothing of yours is due." : "Nothing is due."}</p>
            <p>{filters.mine ? "Claim a company from All due and it shows here." : "Log outreach with a follow-up date and it comes back here when it's due."}</p>
          </Empty>
        ) : (
          <ul className="lg-qlist" aria-label={title}>
            {queue.due.map((row) => (
              <QueueRow key={row.id} workspaceId={workspaceId} row={toRow(row)} />
            ))}
          </ul>
        )}
        {queue.due.length < queue.dueCount && (
          <p className="lg-more">
            <Link href={href({ all: "due" })} scroll={false} className="lg-link">
              Show all {queue.dueCount}
            </Link>
          </p>
        )}

        <section className="lg-never" aria-labelledby="never-title">
          <h2 id="never-title" className="lg-never-title">
            <Link href={href({ never: !filters.never, all: null })} scroll={false} aria-expanded={filters.never} className="lg-never-toggle">
              {filters.never ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
              <span className="lg-h2">Never contacted</span>
              <span className="lg-never-count">
                <Count value={queue.neverCount} />
              </span>
            </Link>
          </h2>
          {queue.never && (
            <>
              <ul className="lg-qlist" aria-label="Never contacted">
                {queue.never.map((row) => (
                  <QueueRow key={row.id} workspaceId={workspaceId} row={toRow(row)} />
                ))}
              </ul>
              {queue.never.length < queue.neverCount && (
                <p className="lg-more">
                  <Link href={href({ never: true, all: "never" })} scroll={false} className="lg-link">
                    Show all {queue.neverCount}
                  </Link>
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
