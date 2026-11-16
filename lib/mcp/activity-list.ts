import type { Membership } from "@/lib/authz";
import { prisma, withTenant } from "@/lib/db";
import { ACTIVITY_GONE_PHRASES, ACTIVITY_UNKNOWN_MEMBER, ACTIVITY_NAME_PREFIX, ACTIVITY_PHRASES, OWNER_ONLY_TOOLS, activityLine } from "@/lib/mcp/activity";
import { safeClientName } from "@/lib/mcp/oauth-limits";

// "What assistants changed": the last rows of the workspace's AssistantActivity log, as the
// Settings page draws them, for every member, except that the rows of OWNER_ONLY_TOOLS (who is
// leaving) are left out unless the viewer is an owner, as the app shows that to owners only. A row holds only the tool, the action key and ids
// (lib/mcp/activity.ts), so every name here is read now, from the company or target itself, and
// follows what the person looking may see:
//
//   a company          its name, with a link to it
//   a contact          the contact's name; a template its name; a member (owners only) the person's name
//   a research source  its label, to an owner always and to an officer only while AI is on (the
//                      same rule as the Research sources section)
//   a fact, the fact sheet, a handoff card or report, an import, an experiment
//                      a fixed phrase, never its text
//
// A target that no longer exists reads as a fixed phrase. One withTenant call reads the rows and
// every label; the assistants' own names come after it, from the OAuth client table (which holds
// no workspace data).

export const ACTIVITY_SHOWN = 50;

// A name (with the noun that goes in front of it, and a link for a company) or a fixed phrase.
export type ActivityLabel = { kind: "name"; prefix: string; text: string; href: string | null } | { kind: "phrase"; text: string };

export type ActivityItem = {
  id: string;
  // The person the assistant acted as, and the assistant's own name (null when it was disconnected for good).
  person: string;
  assistant: string | null;
  verb: string;
  // Null for a line that stands alone ("released the claims of members who are leaving").
  label: ActivityLabel | null;
  // The words after the label, if any ("as leaving" in "marked Sam Lee as leaving").
  after: string;
  at: Date;
};

const phrase = (text: string): ActivityLabel => ({ kind: "phrase", text });

export async function listActivity(member: Membership, options: { aiOn: boolean }): Promise<ActivityItem[]> {
  const { workspaceId } = member;
  const isOwner = member.role === "owner";
  const { rows, contacts, templates, sources, members } = await withTenant(member, async (tx) => {
    const rows = await tx.assistantActivity.findMany({
      where: { workspaceId, ...(isOwner ? {} : { tool: { notIn: [...OWNER_ONLY_TOOLS] } }) },
      // The id breaks ties, so rows logged in the same moment never swap places.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: ACTIVITY_SHOWN,
      select: {
        id: true,
        clientId: true,
        tool: true,
        action: true,
        companyId: true,
        targetId: true,
        createdAt: true,
        user: { select: { name: true } },
        company: { select: { name: true } },
      },
    });
    const idsOf = (kind: string) => [...new Set(rows.flatMap((r) => (r.targetId && activityLine(r.tool, r.action).target === kind ? [r.targetId] : [])))];
    const contactIds = idsOf("contact");
    const templateIds = idsOf("template");
    const memberIds = isOwner ? idsOf("member") : [];
    // An officer sees research sources only while AI is on, so the label is read only then.
    const sourceIds = member.role === "owner" || options.aiOn ? idsOf("source") : [];
    return {
      rows,
      contacts: contactIds.length ? await tx.contact.findMany({ where: { workspaceId, id: { in: contactIds } }, select: { id: true, name: true } }) : [],
      templates: templateIds.length ? await tx.template.findMany({ where: { workspaceId, id: { in: templateIds } }, select: { id: true, name: true } }) : [],
      sources: sourceIds.length ? await tx.researchSource.findMany({ where: { workspaceId, id: { in: sourceIds } }, select: { id: true, label: true } }) : [],
      members: memberIds.length ? await tx.membership.findMany({ where: { workspaceId, userId: { in: memberIds } }, select: { userId: true, user: { select: { name: true } } } }) : [],
    };
  });

  const clientIds = [...new Set(rows.flatMap((r) => (r.clientId ? [r.clientId] : [])))];
  const clients = clientIds.length ? await prisma.oauthClient.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, name: true } }) : [];
  const clientName = new Map(clients.map((c) => [c.clientId, safeClientName(c.name) || null]));

  const names = {
    contact: new Map(contacts.map((c) => [c.id, c.name])),
    template: new Map(templates.map((t) => [t.id, t.name])),
    source: new Map(sources.map((s) => [s.id, s.label])),
    member: new Map(members.map((m) => [m.userId, m.user.name])),
  };
  const sourceVisible = member.role === "owner" || options.aiOn;

  return rows.map((row): ActivityItem => {
    const { verb, target, after } = activityLine(row.tool, row.action);
    let label: ActivityLabel | null = null;
    if (target === "company") {
      label = row.company && row.companyId ? { kind: "name", prefix: "", text: row.company.name, href: `/${workspaceId}/companies/${row.companyId}` } : phrase(ACTIVITY_GONE_PHRASES.company);
    } else if (target === "contact" || target === "template" || target === "source" || target === "member") {
      if (target === "member" && !row.targetId) return { id: row.id, person: row.user.name, assistant: row.clientId ? (clientName.get(row.clientId) ?? null) : null, verb, label: phrase(ACTIVITY_UNKNOWN_MEMBER), after: after ?? "", at: row.createdAt };
      const found = row.targetId ? names[target].get(row.targetId) : undefined;
      label = found && (target !== "source" || sourceVisible) ? { kind: "name", prefix: ACTIVITY_NAME_PREFIX[target], text: found, href: null } : phrase(ACTIVITY_GONE_PHRASES[target]);
    } else if (target !== "none") {
      label = phrase(ACTIVITY_PHRASES[target]);
    }
    return { id: row.id, person: row.user.name, assistant: row.clientId ? (clientName.get(row.clientId) ?? null) : null, verb, label, after: after ?? "", at: row.createdAt };
  });
}
