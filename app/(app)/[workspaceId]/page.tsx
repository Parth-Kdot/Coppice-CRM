import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth-buttons";
import { requireMembershipOr404, roleLabel } from "@/lib/authz";
import { claimState } from "@/lib/claims";
import { day, overdueLabel } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getQueue, type QueueRow } from "@/lib/queue";
import { queueFiltersSchema, queueQuery, type QueueFilters } from "@/lib/validation";
import { claimCompany } from "./companies/actions";

// Workspace home: the follow-up queue. Due companies, most overdue first, then a collapsed list
// of fresh leads. Everything is decided on the server from the URL, like the board.
export default async function QueuePage({ params, searchParams }: PageProps<"/[workspaceId]">) {
  const { workspaceId } = await params;
  const membership = await requireMembershipOr404(workspaceId);
  const { userId } = membership;

  const raw = await searchParams;
  const first = (key: string) => [raw[key]].flat()[0] ?? null;
  const filters = queueFiltersSchema.parse({ mine: first("mine"), never: first("never"), all: first("all") });

  const [workspace, queue] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
    getQueue({ userId, workspaceId }, filters),
  ]);
  const href = (changes: Partial<QueueFilters>) => `/${workspaceId}${queueQuery({ ...filters, ...changes })}`;
  const companyHref = (id: string) => `/${workspaceId}/companies/${id}`;

  // One line per company: name, timing, claim, latest note, and the one button that fits.
  function Row({ row, timing }: { row: QueueRow; timing: string }) {
    const state = claimState(row, queue.now, userId);
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border p-2">
        <Link href={companyHref(row.id)} className="font-medium underline">
          {row.name}
        </Link>
        <span className="text-sm">{timing}</span>
        {state === "mine" && <span className="text-sm text-green-700">Yours until {day(row.claimExpiresAt as Date)}</span>}
        {state === "theirs" && (
          <span className="text-sm">
            Held by {row.claimedBy?.name} until {day(row.claimExpiresAt as Date)}
          </span>
        )}
        {state === "mine" && (
          <Link href={`${companyHref(row.id)}#log-outreach`} className="rounded border px-3 py-1 text-sm">
            Log outreach
          </Link>
        )}
        {(state === "free" || state === "expired") && (
          <ActionForm action={claimCompany} submitLabel="Claim">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="companyId" value={row.id} />
          </ActionForm>
        )}
        {row.lastNote && <span className="w-full truncate text-sm text-zinc-500">&ldquo;{row.lastNote}&rdquo;</span>}
      </li>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-zinc-500">You are {roleLabel(membership.role)}</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href={`/${workspaceId}/board`} className="rounded border px-3 py-1">
            Board
          </Link>
          <Link href={`/${workspaceId}/companies/new`} className="rounded border px-3 py-1">
            Add company
          </Link>
          <Link href={`/${workspaceId}/import`} className="rounded border px-3 py-1">
            Import
          </Link>
          <Link href={`/${workspaceId}/settings`} className="rounded border px-3 py-1">
            Settings
          </Link>
          <Link href="/workspaces" className="rounded border px-3 py-1">
            Switch workspace
          </Link>
          <SignOutButton />
        </nav>
      </header>

      <Link href={href({ mine: !filters.mine, all: null })} scroll={false} aria-pressed={filters.mine} className="self-start text-sm">
        {filters.mine ? "☑" : "☐"} Only mine
      </Link>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Due ({queue.dueCount})</h2>
        {queue.dueCount === 0 && (
          <p className="text-sm text-zinc-500">
            {filters.mine ? "Nothing of yours is due." : "Nothing is due. Log outreach with a follow-up date and it comes back here when it's due."}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {queue.due.map((row) => (
            <Row key={row.id} row={row} timing={overdueLabel(row.nextFollowUpAt as Date, queue.now)} />
          ))}
        </ul>
        {queue.due.length < queue.dueCount && (
          <Link href={href({ all: "due" })} scroll={false} className="text-sm underline">
            Show all {queue.dueCount}
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          <Link href={href({ never: !filters.never, all: null })} scroll={false} aria-expanded={filters.never}>
            {filters.never ? "▾" : "▸"} Never contacted ({queue.neverCount})
          </Link>
        </h2>
        {queue.never && (
          <>
            <ul className="flex flex-col gap-2">
              {queue.never.map((row) => (
                <Row key={row.id} row={row} timing="No outreach yet" />
              ))}
            </ul>
            {queue.never.length < queue.neverCount && (
              <Link href={href({ all: "never" })} scroll={false} className="text-sm underline">
                Show all {queue.neverCount}
              </Link>
            )}
          </>
        )}
      </section>
    </main>
  );
}
