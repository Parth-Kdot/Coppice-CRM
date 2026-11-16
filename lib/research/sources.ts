import type { Membership } from "@/lib/authz";
import { withTenant, type Tenant } from "@/lib/db";
import { notFound, OWNERS_ONLY } from "@/lib/messages";
import { SOURCE_LABEL_MAX, type ActionResult } from "@/lib/validation";

// The approved sources: the only pages research briefs may read. Owners add, label and archive
// them (archiving is removing; nothing is deleted). Officers can see the list. Each write is
// checked here and again by the database (only owners pass ResearchSource's row-level security).

const RESEARCH_SOURCES_MAX = 50;

const NOT_FOUND = notFound("Source");

export type SourceView = { id: string; url: string; label: string; createdAt: Date; addedBy: { name: string } };

export function listSources(tenant: Tenant): Promise<SourceView[]> {
  return withTenant(tenant, (tx) =>
    tx.researchSource.findMany({
      where: { workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true, url: true, label: true, createdAt: true, addedBy: { select: { name: true } } },
      orderBy: [{ label: "asc" }, { id: "asc" }],
    }),
  );
}

// `url` is already checked and normalized by addResearchSourceSchema. Without a label, the
// page's host and path are used ("careers.acme.com/students"), so two pages on one site don't
// look the same.
export function defaultSourceLabel(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, "");
  const label = `${hostname}${path}`;
  return label.length > SOURCE_LABEL_MAX ? `${label.slice(0, SOURCE_LABEL_MAX - 1)}…` : label;
}

export function addSource(owner: Membership, url: string, label: string | null): Promise<ActionResult<{ sourceId: string }>> {
  if (owner.role !== "owner") return Promise.resolve(OWNERS_ONLY);
  return withTenant(owner, async (tx) => {
    const active = await tx.researchSource.findMany({ where: { workspaceId: owner.workspaceId, archivedAt: null }, select: { url: true } });
    if (active.some((s) => s.url === url)) return { ok: false, error: "That page is already on the list." };
    if (active.length >= RESEARCH_SOURCES_MAX) return { ok: false, error: `A workspace can have at most ${RESEARCH_SOURCES_MAX} sources. Archive one first.` };
    const source = await tx.researchSource.create({
      data: { workspaceId: owner.workspaceId, url, label: label ?? defaultSourceLabel(url), addedById: owner.userId },
      select: { id: true },
    });
    return { ok: true, data: { sourceId: source.id } };
  });
}

export function renameSource(owner: Membership, sourceId: string, label: string): Promise<ActionResult> {
  if (owner.role !== "owner") return Promise.resolve(OWNERS_ONLY);
  return withTenant(owner, async (tx) => {
    const { count } = await tx.researchSource.updateMany({ where: { id: sourceId, workspaceId: owner.workspaceId, archivedAt: null }, data: { label } });
    return count === 1 ? { ok: true, data: undefined } : NOT_FOUND;
  });
}

// Briefs that already read the page keep their copy of it.
export function archiveSource(owner: Membership, sourceId: string): Promise<ActionResult> {
  if (owner.role !== "owner") return Promise.resolve(OWNERS_ONLY);
  return withTenant(owner, async (tx) => {
    const { count } = await tx.researchSource.updateMany({
      where: { id: sourceId, workspaceId: owner.workspaceId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return count === 1 ? { ok: true, data: undefined } : NOT_FOUND;
  });
}
