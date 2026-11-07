import type { Metadata } from "next";
import Link from "next/link";
import { FirstRun } from "@/components/ledger/first-run";
import { PlusIcon } from "@/components/ledger/icons";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { FreshLeads, HeldByOthers, QueueProvider, QueueRow, type QueueRowData, type RowVariant } from "@/components/ledger/queue-row";
import { Empty, PageHead } from "@/components/ledger/shared";
import { MoreLink, ShowMore } from "@/components/ledger/show-more";
import { claimState } from "@/lib/claims";
import { daysBetween, day } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { clampUpto, getQueueHome, QUEUE_STEP, type QueueGroup, type QueueRow as QueueRecord } from "@/lib/queue";
import { queueFiltersSchema, queueQuery } from "@/lib/validation";
import { loadWorkspace, pageTitle } from "./page-title";

export async function generateMetadata({ params }: PageProps<"/[workspaceId]">): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageTitle(workspaceId, "Queue");
}

// Rows each group shows before "Show all".
const FIRST = 10;

// Workspace home: the follow-up queue. Due companies in groups, so a newcomer sees at once what is
// theirs to do: Yours (due, held by you), Up for grabs (due, nobody holds them), then two collapsed
// lists, Held by others and Fresh leads. Each group shows 10, then the rest of the 50 it loaded,
// then "Show 50 more" (?upto=) up to 200. A workspace with no companies gets the first-run panel.
// The clock, the membership and the company count come from the layout's cached loadWorkspace.
export default async function QueuePage({ params, searchParams }: PageProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const { membership, workspace, counts, now } = await loadWorkspace(workspaceId);
  const base = `/${workspaceId}`;

  if (counts.companies === 0) {
    const owner = membership.role === "owner";
    // Step 3 ticks once someone else is in, or an invitation is waiting. Only asked for an owner.
    const invited = owner
      ? (await prisma.membership.count({ where: { workspaceId } })) > 1 ||
        (await prisma.invitation.count({ where: { workspaceId, status: "pending", expiresAt: { gt: now } } })) > 0
      : false;
    return (
      <div className="lg-queue">
        <FirstRun workspaceId={workspaceId} owner={owner} invited={invited} />
      </div>
    );
  }

  const raw = await searchParams;
  const first = (key: string) => [raw[key]].flat()[0] ?? null;
  // mine / never / all are still read so old links load; only `never` means something now (it opens Fresh leads).
  const filters = queueFiltersSchema.parse({ mine: first("mine"), never: first("never"), all: first("all"), upto: first("upto") });
  const upto = clampUpto(filters.upto);

  const home = await getQueueHome(membership, { upto, now });
  const total = home.yours.count + home.grabs.count + home.heldByOthers.count;
  const windowDays = workspace.claimWindowDays;

  const toRow = (row: QueueRecord): QueueRowData => ({
    id: row.id,
    name: row.name,
    days: row.nextFollowUpAt ? daysBetween(row.nextFollowUpAt, now) : null,
    dueOn: row.nextFollowUpAt ? day(row.nextFollowUpAt) : null,
    note: row.lastNote,
    claim: {
      state: claimState(row, now, membership.userId),
      holderName: row.claimedBy?.name ?? null,
      until: row.claimExpiresAt ? day(row.claimExpiresAt) : null,
    },
  });

  const moreHref = `${base}${queueQuery({ mine: false, never: false, all: null, upto: Math.min(upto + QUEUE_STEP, 200) })}`;
  const group = (g: QueueGroup, variant: RowVariant, label: string) => {
    const hidden = g.rows.length - FIRST;
    return (
      <ShowMore
        as="ul"
        listClassName="lg-qlist"
        listLabel={label}
        initial={FIRST}
        label="follow-ups"
        moreText={g.count > g.rows.length ? `Show ${hidden} more` : undefined}
        after={<MoreLink href={moreHref} shown={g.rows.length} total={g.count} step={QUEUE_STEP} cap={200} />}
      >
        {g.rows.map((row) => (
          <QueueRow key={row.id} workspaceId={workspaceId} row={toRow(row)} variant={variant} windowDays={windowDays} />
        ))}
      </ShowMore>
    );
  };

  const notDueLine =
    home.yoursNotDue > 0 ? (
      <p className="lg-muted lg-qhint">
        {home.yours.count > 0 ? "You also hold" : "You hold"} {home.yoursNotDue} {home.yoursNotDue === 1 ? "company that isn't" : "companies that aren't"} due yet.{" "}
        <Link href={`${base}/board`} className="lg-link">
          See the board
        </Link>
      </p>
    ) : null;

  return (
    <QueueProvider>
      <div className="lg-queue">
        <PageHead title="Follow-ups due" count={total > 0 ? total : undefined}>
          <OverflowMenu
            label="Add companies"
            buttonText="Add"
            icon={<PlusIcon size={16} />}
            caret
            align="right"
            data-tour="add-menu"
            items={[
              { key: "new", label: "Add a company", href: `${base}/companies/new` },
              { key: "import", label: "Import a spreadsheet", href: `${base}/import` },
            ]}
          />
        </PageHead>

        {/* Nothing due: with fresh leads waiting (a sheet just imported, say) that is where to start,
            so they open below; "All caught up" is only said when there is nothing left to pick. */}
        {total === 0 && (
          <Empty kind="queue-due">
            {home.freshCount > 0 ? (
              <>
                <p className="lg-empty-title">Nothing due yet.</p>
                <p>
                  Start with a{" "}
                  <a href="#fresh" className="lg-link">
                    fresh lead
                  </a>{" "}
                  below: claim it, email them, and log it.
                </p>
              </>
            ) : (
              <>
                <p className="lg-empty-title">All caught up.</p>
                <p>Log outreach with a follow-up date and it comes back here when it&apos;s due.</p>
              </>
            )}
          </Empty>
        )}

        <div className="lg-qtable" data-tour="queue-list">
          {(home.yours.count > 0 || home.yoursNotDue > 0) && (
            <section id="yours" className="lg-qgroup" aria-labelledby="yours-title" tabIndex={-1}>
              <h2 id="yours-title" className="lg-qgroup-title">
                Yours {home.yours.count > 0 && <span className="lg-qgroup-n">{home.yours.count.toLocaleString("en-US")}</span>}
              </h2>
              {home.yours.count > 0 && group(home.yours, "yours", "Yours")}
              {notDueLine}
            </section>
          )}
          {home.grabs.count > 0 && (
            <section id="grabs" className="lg-qgroup" aria-labelledby="grabs-title">
              <h2 id="grabs-title" className="lg-qgroup-title">
                Up for grabs <span className="lg-qgroup-n">{home.grabs.count.toLocaleString("en-US")}</span>
              </h2>
              {group(home.grabs, "grabs", "Up for grabs")}
            </section>
          )}
        </div>

        {home.heldByOthers.count > 0 && (
          <HeldByOthers count={home.heldByOthers.count} ids={home.heldByOthers.rows.map((r) => r.id)}>
            <ul className="lg-qlist" aria-label="Held by others">
              {home.heldByOthers.rows.map((row) => (
                <QueueRow key={row.id} workspaceId={workspaceId} row={toRow(row)} variant="held" />
              ))}
            </ul>
            {home.heldByOthers.count > home.heldByOthers.rows.length && (
              <p className="lg-morelink lg-muted">
                Showing {home.heldByOthers.rows.length} of {home.heldByOthers.count.toLocaleString("en-US")}.{" "}
                <Link href={`${base}/board`} className="lg-link">
                  See the board
                </Link>
              </p>
            )}
          </HeldByOthers>
        )}

        {home.freshCount > 0 && <FreshLeads workspaceId={workspaceId} count={home.freshCount} defaultOpen={filters.never || total === 0} windowDays={windowDays} />}
      </div>
    </QueueProvider>
  );
}
