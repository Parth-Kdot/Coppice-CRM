import type { z } from "zod";
import { Stage } from "@/generated/prisma/enums";
import { dbNow } from "@/lib/claims";
import { listMembers as listOwnerMembers } from "@/lib/capsule/members";
import { aiUsage } from "@/lib/ai/run";
import { listIndustries } from "@/lib/companies";
import { prisma, withTenant } from "@/lib/db";
import { roleLabel, toRole } from "@/lib/roles";
import { listMyWorkspaces, workspaceRow } from "@/lib/workspaces";
import { MCP_LIST_LIMIT, type mcpListMembersSchema, type mcpWorkspaceSchema } from "@/lib/validation";
import { BAD_CURSOR, decodeCursor, fail, iso, limited, moreFields, ok, openWorkspace, untrusted, type McpPrincipal, type ToolResult } from "./shared";

// Group W, the workspace itself. Everything here is read only: members, roles, invitations, the
// claim window, the AI switch and its limit and the assistants switch can be looked at, never
// changed, from an assistant.

const offNote = (n: number) => (n === 1 ? "1 more of your workspaces has assistants turned off." : `${n} more of your workspaces have assistants turned off.`);

// Only workspaces the person belongs to and whose owner turned MCP on.
export async function listWorkspaces(principal: McpPrincipal): Promise<ToolResult> {
  const tooMany = await limited(principal, "read");
  if (tooMany) return tooMany;
  const rows = await listMyWorkspaces(principal.userId);
  const open = rows.filter((r) => r.workspace.mcpEnabled);
  return ok({
    workspaces: open.map((r) => ({ id: r.workspace.id, name: untrusted(r.workspace.name), yourRole: roleLabel(toRole(r.role)) })),
    ...(rows.length > open.length ? { note: offNote(rows.length - open.length) } : {}),
  });
}

// The settings an officer or an owner can see on the Settings page, plus the counts the board shows.
export async function getWorkspace(principal: McpPrincipal, args: z.infer<typeof mcpWorkspaceSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const workspace = await workspaceRow(member.workspaceId);
  const ai = await aiUsage(member);
  const industries = await listIndustries(member);
  const counts = await withTenant(member, async (tx) => {
    const where = { workspaceId: member.workspaceId };
    const byStage = await tx.company.groupBy({ by: ["stage"], where: { ...where, archivedAt: null }, _count: { _all: true } });
    const archived = await tx.company.count({ where: { ...where, archivedAt: { not: null } } });
    const templates = await tx.template.count({ where: { ...where, archivedAt: null } });
    return { byStage, archived, templates };
  });
  const perStage = new Map(counts.byStage.map((g) => [g.stage, g._count._all]));
  return ok({
    workspace: {
      id: member.workspaceId,
      name: untrusted(workspace.name),
      yourRole: roleLabel(member.role),
      claimWindowDays: workspace.claimWindowDays,
      ai: { on: ai.enabled, monthlyLimit: ai.limit, usedLast30Days: ai.used },
      assistantsOn: workspace.mcpEnabled,
      stageCounts: Object.fromEntries(Object.values(Stage).map((s) => [s, perStage.get(s) ?? 0])),
      archivedCount: counts.archived,
      industries: industries.map((i) => untrusted(i)),
      activeTemplateCount: counts.templates,
    },
  });
}

// The same rows the Settings page lists: name, role and joined date for every member. Owners also
// get emails, who is leaving and how many claims each person holds (lib/capsule/members.ts), and
// the invitations still waiting. An officer never gets an email, an invitation or a user id.
export async function listMembers(principal: McpPrincipal, args: z.infer<typeof mcpListMembersSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const isOwner = member.role === "owner";
  const rows = await prisma.membership.findMany({
    where: { workspaceId: member.workspaceId },
    select: { userId: true, role: true, createdAt: true, user: { select: { name: true } } },
    // The id order breaks ties (an import of members can share a timestamp), as Settings does.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: offset,
    take: MCP_LIST_LIMIT + 1,
  });
  const page = rows.slice(0, MCP_LIST_LIMIT);
  const owner = isOwner ? await listOwnerMembers(member) : null;
  const extra = new Map((owner?.ok ? owner.data : []).map((m) => [m.userId, m]));
  const invitations = isOwner
    ? await prisma.invitation.findMany({
        where: { workspaceId: member.workspaceId, status: "pending", expiresAt: { gt: await dbNow() } },
        select: { email: true, role: true, expiresAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MCP_LIST_LIMIT,
      })
    : [];
  return ok({
    members: page.map((m) => {
      const more = extra.get(m.userId);
      return {
        ...(isOwner ? { userId: m.userId } : {}),
        name: untrusted(m.user.name),
        role: roleLabel(toRole(m.role)),
        joinedAt: iso(m.createdAt),
        ...(isOwner ? { email: untrusted(more?.email), leaving: more?.departingAt != null, leavingSince: more?.departingAt ?? null, claimsHeld: more?.claims ?? 0 } : {}),
      };
    }),
    ...(isOwner
      ? { invitations: invitations.map((i) => ({ email: untrusted(i.email), role: roleLabel(toRole(i.role ?? "member")), expiresAt: iso(i.expiresAt) })) }
      : {}),
    ...moreFields(rows.length > MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Members are listed oldest first."),
  });
}
