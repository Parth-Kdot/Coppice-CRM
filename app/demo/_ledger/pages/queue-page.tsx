"use client";

import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/ledger/icons";
import { QueueRow, type QueueRowData } from "@/components/ledger/queue-row";
import { Count, Empty, PageHead } from "@/components/ledger/shared";
import { day, daysBetween } from "@/lib/dates";
import { queueQuery, type QueueFilters as RealFilters } from "@/lib/validation";
import { useDemoState, useMe, useQueue, useQueueFilters } from "@/demo/store";
import { claimData } from "../view";
import type { QueueRow as DemoRow } from "@/demo/selectors";

// The queue, drawn as the real one is. Its numbers come from the in-browser store.
export function QueuePage({ ws }: { ws: string }) {
  const filters = useQueueFilters();
  const me = useMe(ws);
  const { now } = useDemoState();
  const queue = useQueue(ws, { ...filters, view: "all", sort: "overdue", overdue: false });
  const all = useQueue(ws, { ...filters, mine: false, never: false, all: null });
  const mine = useQueue(ws, { ...filters, mine: true, never: false, all: null });
  const nowDate = new Date(now);

  const href = (changes: Partial<RealFilters>) => {
    const next = { mine: filters.mine, never: filters.never, all: filters.all, ...changes };
    return `/demo/w/${ws}${queueQuery(next)}`;
  };

  const toRow = (row: DemoRow): QueueRowData => ({
    id: row.company.id,
    name: row.company.name,
    days: row.company.nextFollowUpAt ? daysBetween(new Date(row.company.nextFollowUpAt), nowDate) : null,
    dueOn: row.company.nextFollowUpAt ? day(new Date(row.company.nextFollowUpAt)) : null,
    note: row.lastNote,
    claim: claimData(row.claim),
  });

  const oldest = all.due.reduce<string | null>((o, r) => (r.company.nextFollowUpAt && (o === null || r.company.nextFollowUpAt < o) ? r.company.nextFollowUpAt : o), null);
  const longest = oldest ? Math.max(0, daysBetween(new Date(oldest), nowDate)) : 0;
  const title = filters.mine ? "Yours, due" : "Follow-ups due";
  const neverOpen = filters.never;

  return (
    <div className="lg-queue">
      <PageHead title={title} count={queue.dueCount} sub={`You are an ${(me.roleLabel ?? "Officer").toLowerCase()} here.`}>
        <Link href={`/demo/w/${ws}/import`} className="lg-btn">
          Import
        </Link>
        <Link href={`/demo/w/${ws}/companies/new`} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          Add company
        </Link>
      </PageHead>

      <nav className="lg-totals" aria-label="Queue totals">
        <Link href={href({ mine: false, all: null })} className="lg-total" aria-current={!filters.mine ? "true" : undefined}>
          <span className="lg-tag">All due</span>
          <span className="lg-total-n">
            <Count value={all.dueCount} />
          </span>
        </Link>
        <Link href={href({ mine: true, all: null })} className="lg-total" aria-current={filters.mine ? "true" : undefined}>
          <span className="lg-tag">Held by you</span>
          <span className="lg-total-n">
            <Count value={mine.dueCount} />
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
              <QueueRow key={row.company.id} workspaceId={ws} row={toRow(row)} />
            ))}
          </ul>
        )}
        {queue.hasMoreDue && (
          <p className="lg-more">
            <Link href={href({ all: "due" })} scroll={false} className="lg-link">
              Show all {queue.dueCount}
            </Link>
          </p>
        )}

        <section className="lg-never" aria-labelledby="never-title">
          <h2 id="never-title" className="lg-never-title">
            <Link href={href({ never: !neverOpen, all: null })} scroll={false} aria-expanded={neverOpen} className="lg-never-toggle">
              {neverOpen ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
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
                  <QueueRow key={row.company.id} workspaceId={ws} row={toRow(row)} />
                ))}
              </ul>
              {queue.hasMoreNever && (
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
