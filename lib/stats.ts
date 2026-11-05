import { dbNow } from "@/lib/claims";
import { withTenant, type Tenant } from "@/lib/db";
import { REPLY_STAGES } from "@/lib/stages";
import { scorecard, type OutreachRow, type Scorecard, type Split } from "@/lib/stats-math";

// Template stats (the Scorecard): reads the workspace's templates, outreach and companies in three
// flat queries inside withTenant, then hands them to lib/stats-math.ts, which does all the counting.
// The touch split needs each company's outreach in time order, which an aggregate can't give
// without raw SQL (kept to lib/claims.ts and lib/db.ts), so the outreach is read as rows: three
// queries whatever the size of the workspace, never one per template or company.
//
// Archived templates are included (marked archived): their outreach is history the chair still
// needs. Archived companies' outreach counts too; only the "replied but nothing marked" gap leaves
// archived companies out, since nobody can act on those.

export type StatsView = Scorecard & { now: Date };

export async function workspaceStats(tenant: Tenant, split: Split = "none"): Promise<StatsView> {
  // The database's clock decides which sends are old enough to count (lib/stats-math.ts).
  const now = await dbNow();
  const { workspaceId } = tenant;
  const data = await withTenant(tenant, async (tx) => {
    const templates = await tx.template.findMany({
      where: { workspaceId },
      select: { id: true, name: true, archivedAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const outreach = await tx.outreach.findMany({
      where: { workspaceId },
      select: { id: true, companyId: true, templateId: true, channel: true, sentAt: true, gotReply: true, aiDraftId: true },
    });
    const companies = await tx.company.findMany({
      where: { workspaceId, OR: [{ outreach: { some: {} } }, { stage: { in: REPLY_STAGES } }] },
      select: { id: true, industry: true, stage: true, archivedAt: true },
    });
    return { templates, outreach, companies };
  });

  const industry = new Map(data.companies.map((c) => [c.id, c.industry]));
  const rows: OutreachRow[] = data.outreach.map(({ aiDraftId, ...o }) => ({ ...o, aiDrafted: aiDraftId !== null, industry: industry.get(o.companyId) ?? null }));
  const card = scorecard(
    {
      now,
      rows,
      templates: data.templates.map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null })),
      repliedCompanyIds: data.companies.filter((c) => c.archivedAt === null && REPLY_STAGES.includes(c.stage)).map((c) => c.id),
    },
    split,
  );
  return { ...card, now };
}
