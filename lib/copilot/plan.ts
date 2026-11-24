import type { Membership } from "@/lib/authz";
import { dbNow } from "@/lib/claims";
import { withTenant } from "@/lib/db";
import { getFreshLeads, getQueueHome } from "@/lib/queue";
import { ROW_SELECT, toRow, type CopilotRow } from "@/lib/copilot/query";
import { formatCount } from "@/lib/stats-math";

// "Plan my 30 minutes": pure code, no model. From the queue (lib/queue.ts): the overdue companies
// the person holds come first, then free overdue ones, then fresh leads nobody has contacted. About
// five minutes each, so minutes divided by five companies, at most ten, each with its next move.

export const MINUTES_PER_ITEM = 5;
export const PLAN_MAX_ITEMS = 10;

export const planItems = (minutes: number) => Math.min(PLAN_MAX_ITEMS, Math.max(1, Math.floor(minutes / MINUTES_PER_ITEM)));

export type Plan = { rows: CopilotRow[]; items: number; dueTotal: number; summary: string };

export async function buildPlan(member: Membership, minutes: number, now?: Date): Promise<Plan> {
  const at = now ?? (await dbNow());
  const items = planItems(minutes);
  const queue = await getQueueHome(member, { now: at });

  const picks: { id: string; why: string }[] = [
    ...queue.yours.rows.map((r) => ({ id: r.id, why: "Yours and overdue" })),
    ...queue.grabs.rows.map((r) => ({ id: r.id, why: "Free and overdue" })),
  ].slice(0, items);
  if (picks.length < items && queue.freshCount > 0) {
    const fresh = await getFreshLeads(member, 0, at);
    for (const lead of fresh.rows) {
      if (picks.length >= items) break;
      picks.push({ id: lead.id, why: "Never contacted" });
    }
  }

  // The rows as the lists show them (stage, claim, dates): one read, kept in the plan's order.
  const sources = picks.length === 0 ? [] : await withTenant(member, (tx) =>
    tx.company.findMany({ where: { workspaceId: member.workspaceId, archivedAt: null, id: { in: picks.map((p) => p.id) } }, select: ROW_SELECT }),
  );
  const byId = new Map(sources.map((s) => [s.id, s]));
  const rows = picks.flatMap((p) => {
    const source = byId.get(p.id);
    return source ? [toRow(member.workspaceId, source, member, at, p.why)] : [];
  });

  const dueTotal = queue.yours.count + queue.grabs.count;
  const summary =
    rows.length === 0
      ? "Nothing is due and there are no fresh leads right now."
      : `A plan for ${minutes} minutes: ${rows.length} ${rows.length === 1 ? "company" : "companies"}, about ${MINUTES_PER_ITEM} minutes each.` +
        (dueTotal > rows.filter((r) => r.why !== "Never contacted").length ? ` ${formatCount(dueTotal)} are due in all.` : "");
  return { rows, items, dueTotal, summary };
}
