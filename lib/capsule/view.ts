import type { Stage } from "@/generated/prisma/enums";
import { aiUsage } from "@/lib/ai/run";
import type { Membership } from "@/lib/authz";
import { withTenant } from "@/lib/db";
import { isConfigured } from "@/lib/ai/client";
import { planReading } from "./select";
import { fail, isOwner, OWNER_ONLY, type Done } from "./shared";
import { cardBody, type CardBullet, type CardFacts } from "./types";
import { yearWindow } from "./year";

// What the capsule page reads. Two functions, on purpose, so who may see what is decided in one
// place each and tested:
//
//   ownerView   an owner's whole working view of one board year's handoff: every card, hidden or
//               not, approved or not, whatever the status. Refused for anyone but an owner.
//   memberView  what officers see: nothing until the handoff is PUBLISHED, then only cards an owner
//               approved, not hidden, with their hidden bullets removed. The same for an owner, so
//               "what officers see" is one function.
//
// Row-level security keeps both inside the workspace; the published, approved and unhidden rules
// live here, not in the database (the rows are readable by every member of the workspace).

export type ReportInfo = {
  id: string;
  boardYearStart: number;
  label: string;
  status: "DRAFT" | "PUBLISHED";
  createdAt: string;
  publishedAt: string | null;
};

export type BulletView = CardBullet & { index: number; hidden: boolean };
export type CardView = {
  id: string;
  companyId: string;
  companyName: string;
  source: "AI" | "CODE";
  model: string | null;
  facts: CardFacts;
  bullets: BulletView[];
  hidden: boolean;
  approved: boolean;
  approvedAt: string | null;
  recontactOn: string | null;
};

export type OwnerView = {
  report: ReportInfo & { companies: number; chunkCount: number };
  // Chunks of the reading with all their cards, how many there are, and the first one still to read
  // (null when all are read).
  chunks: { total: number; done: number; next: number | null };
  // In the report's order: stage, then outreach. Group by stage on the page.
  cards: CardView[];
  counts: { cards: number; approved: number; hidden: number; pending: number };
  // Whether the workspace has AI on and the server has a key: when not, the page offers code-only cards.
  ai: { on: boolean; configured: boolean };
};

const reportInfo = (r: { id: string; boardYearStart: number; status: "DRAFT" | "PUBLISHED"; createdAt: Date; publishedAt: Date | null }): ReportInfo => ({
  id: r.id,
  boardYearStart: r.boardYearStart,
  label: yearWindow(r.boardYearStart).label,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  publishedAt: r.publishedAt?.toISOString() ?? null,
});

type CardRow = {
  id: string;
  companyId: string;
  source: "AI" | "CODE";
  model: string | null;
  bullets: unknown;
  approvedAt: Date | null;
  recontactOn: string | null;
  company: { name: string };
  redactions: { bulletIndex: number | null }[];
};

const CARD_SELECT = {
  id: true,
  companyId: true,
  source: true,
  model: true,
  bullets: true,
  approvedAt: true,
  recontactOn: true,
  company: { select: { name: true } },
  redactions: { select: { bulletIndex: true } },
} as const;

function cardView(row: CardRow): CardView {
  const body = cardBody(row.bullets);
  const hidden = new Set(row.redactions.map((r) => r.bulletIndex));
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    source: row.source,
    model: row.model,
    facts: body.facts,
    bullets: body.bullets.map((b, index) => ({ ...b, index, hidden: hidden.has(index) })),
    hidden: hidden.has(null),
    approved: row.approvedAt !== null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    recontactOn: row.recontactOn,
  };
}

// The handoff for a board year as its owner sees it, or null when none has been started.
export async function ownerView(actor: Membership, boardYearStart: number): Promise<Done<OwnerView | null>> {
  if (!isOwner(actor)) return fail(OWNER_ONLY);
  const { workspaceId } = actor;
  const [usage, data] = await Promise.all([
    aiUsage(actor),
    withTenant(actor, async (tx) => {
      const report = await tx.handoffReport.findUnique({ where: { workspaceId_boardYearStart: { workspaceId, boardYearStart } } });
      if (!report) return null;
      const rows = await tx.relationshipCard.findMany({ where: { reportId: report.id, workspaceId }, select: CARD_SELECT });
      return { report, rows };
    }),
  ]);
  if (!data) return { ok: true, data: null };
  const ids = data.report.companyIds as string[];
  const order = new Map(ids.map((id, i) => [id, i]));
  const cards = data.rows.map((r) => cardView(r as CardRow)).sort((a, b) => (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0));
  const have = new Set(cards.map((c) => c.companyId));
  const chunks = planReading(ids).chunks;
  const next = chunks.findIndex((chunk) => !chunk.every((id) => have.has(id)));
  return {
    ok: true,
    data: {
      report: { ...reportInfo(data.report), companies: ids.length, chunkCount: data.report.chunkCount },
      chunks: { total: chunks.length, done: chunks.filter((chunk) => chunk.every((id) => have.has(id))).length, next: next === -1 ? null : next },
      cards,
      counts: {
        cards: cards.length,
        approved: cards.filter((c) => c.approved).length,
        hidden: cards.filter((c) => c.hidden).length,
        pending: cards.filter((c) => !c.approved && !c.hidden).length,
      },
      ai: { on: usage.enabled, configured: isConfigured("groq") },
    },
  };
}

export type MemberCard = {
  id: string;
  companyId: string;
  companyName: string;
  source: "AI" | "CODE";
  stage: Stage;
  facts: CardFacts;
  // Only the bullets an owner left visible.
  bullets: CardBullet[];
  recontactOn: string | null;
};

// A bullet as an officer reads it: no index or hidden flag.
function toMemberBullet(b: BulletView): CardBullet {
  return { section: b.section, text: b.text, quote: b.quote, source: b.source, month: b.month };
}

export type MemberView = { report: ReportInfo; cards: MemberCard[] };

// The published handoff for a board year, as an officer reads it, or null when there is none or it
// is not published (a draft is invisible to everyone but its owner's own view). Only approved cards
// that are not hidden, with hidden bullets taken out.
export async function memberView(actor: Membership, boardYearStart: number): Promise<MemberView | null> {
  const { workspaceId } = actor;
  const data = await withTenant(actor, async (tx) => {
    const report = await tx.handoffReport.findFirst({ where: { workspaceId, boardYearStart, status: "PUBLISHED" } });
    if (!report) return null;
    const rows = await tx.relationshipCard.findMany({ where: { reportId: report.id, workspaceId, approvedAt: { not: null } }, select: CARD_SELECT });
    return { report, rows };
  });
  if (!data) return null;
  const order = new Map((data.report.companyIds as string[]).map((id, i) => [id, i]));
  const cards = data.rows
    .map((r) => cardView(r as CardRow))
    .filter((c) => !c.hidden)
    .sort((a, b) => (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0))
    .map((c): MemberCard => ({
      id: c.id,
      companyId: c.companyId,
      companyName: c.companyName,
      source: c.source,
      stage: c.facts.stage,
      facts: c.facts,
      bullets: c.bullets.filter((b) => !b.hidden).map(toMemberBullet),
      recontactOn: c.recontactOn,
    }));
  return { report: reportInfo(data.report), cards };
}

export type YearRow = { boardYearStart: number; label: string; status: "DRAFT" | "PUBLISHED"; publishedAt: string | null };

// The board years that have a handoff, newest first, for the year switcher: every report for an
// owner, only published ones for an officer.
export async function listYears(actor: Membership): Promise<YearRow[]> {
  const { workspaceId } = actor;
  const rows = await withTenant(actor, (tx) =>
    tx.handoffReport.findMany({
      where: { workspaceId, ...(isOwner(actor) ? {} : { status: "PUBLISHED" as const }) },
      select: { boardYearStart: true, status: true, publishedAt: true },
      orderBy: { boardYearStart: "desc" },
    }),
  );
  return rows.map((r) => ({ boardYearStart: r.boardYearStart, label: yearWindow(r.boardYearStart).label, status: r.status, publishedAt: r.publishedAt?.toISOString() ?? null }));
}
