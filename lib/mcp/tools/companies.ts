import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { literal } from "@/lib/board";
import { changeStage, claimCompany, dbNow, dbToday, heldBy, logOutreach } from "@/lib/claims";
import { getCompanyPage } from "@/lib/companies";
import { filterClauses } from "@/lib/copilot/query";
import { withTenant } from "@/lib/db";
import { recentDrafts } from "@/lib/drafts";
import { notFoundMessage } from "@/lib/messages";
import { getQueue, type QueueRow } from "@/lib/queue";
import { latestBrief } from "@/lib/research/brief";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { workspaceRow } from "@/lib/workspaces";
import {
  MCP_LIST_LIMIT,
  type mcpChangeStageSchema,
  type mcpCompanySchema,
  type mcpListCompaniesSchema,
  type mcpListMyClaimsSchema,
  type mcpLogOutreachSchema,
  type mcpQueueSchema,
} from "@/lib/validation";
import {
  BAD_CURSOR,
  claimInfo,
  confirmNeeded,
  confirmNeededLater,
  decodeCursor,
  fail,
  fromResult,
  iso,
  moreFields,
  ok,
  openWorkspace,
  recordActivity,
  refusedBy,
  untrusted,
  type McpPrincipal,
  type ToolResult,
} from "./shared";

// Group C, companies and claims: finding companies, reading one, the follow-up queue, and the
// changes the app makes through lib/claims.ts (claim, log outreach, move a stage).

const ORDER: Record<NonNullable<z.infer<typeof mcpListCompaniesSchema>["sort"]>, Prisma.CompanyOrderByWithRelationInput[]> = {
  name: [{ name: "asc" }, { id: "asc" }],
  follow_up: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  last_contact: [{ lastContactedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  created: [{ createdAt: "desc" }, { id: "asc" }],
};
// The tool's words for who holds a company, and for a follow-up date, in the words Ask Coppice's
// filter uses (lib/copilot/query.ts filterClauses).
const CLAIM_FILTER = { mine: "mine", free: "free", others: "held_by_others" } as const;
const DUE_FILTER = { overdue: "overdue", due_this_week: "due_this_week", none: "no_date" } as const;

export async function listCompanies(principal: McpPrincipal, args: z.infer<typeof mcpListCompaniesSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const now = await dbNow();
  const today = await dbToday();
  const contains = args.query ? ({ contains: literal(args.query), mode: "insensitive" } as const) : null;
  const status = args.status ?? "active";
  // The single stage field and the list of stages are one union.
  const stages = [...new Set([...(args.stage ? [args.stage] : []), ...(args.stages ?? [])])];
  const where: Prisma.CompanyWhereInput = {
    AND: [
      { workspaceId: member.workspaceId },
      status === "active" ? { archivedAt: null } : status === "archived" ? { archivedAt: { not: null } } : {},
      stages.length > 0 ? { stage: { in: stages } } : {},
      contains ? { OR: [{ name: contains }, { website: contains }, { industry: contains }] } : {},
      ...filterClauses(
        {
          industry: args.industry ?? null,
          due: args.followUp ? DUE_FILTER[args.followUp] : "any",
          claim: args.claim ? CLAIM_FILTER[args.claim] : "any",
          neverContacted: args.neverContacted ?? false,
          notesMention: args.notesMention ?? null,
        },
        member,
        now,
        today,
      ),
    ],
  };
  const rows = await withTenant(member, (tx) =>
    tx.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        industry: true,
        website: true,
        stage: true,
        archivedAt: true,
        nextFollowUpAt: true,
        claimedById: true,
        claimExpiresAt: true,
        claimedBy: { select: { name: true } },
      },
      orderBy: ORDER[args.sort ?? "name"],
      skip: offset,
      take: MCP_LIST_LIMIT + 1,
    }),
  );
  return ok({
    companies: rows.slice(0, MCP_LIST_LIMIT).map((c) => ({
      id: c.id,
      name: untrusted(c.name),
      industry: untrusted(c.industry),
      website: untrusted(c.website),
      stage: c.stage,
      archived: c.archivedAt !== null,
      nextFollowUpAt: iso(c.nextFollowUpAt),
      claim: claimInfo(c, now, member.userId),
    })),
    ...moreFields(rows.length > MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Search with query or add filters to narrow it down."),
  });
}

export async function getCompany(principal: McpPrincipal, args: z.infer<typeof mcpCompanySchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const now = await dbNow();
  const page = await getCompanyPage(member, args.companyId);
  if (!page) return fail(notFoundMessage("Company"));
  const { company: c, lookAlikes } = page;
  // The company page shows stored briefs and drafts only while AI is on for the workspace; so do we.
  // These are reads of what is already stored: nothing here asks a model for anything.
  const aiOn = (await workspaceRow(member.workspaceId)).aiEnabled;
  const brief = aiOn ? await latestBrief(member, args.companyId) : null;
  const drafts = aiOn ? await recentDrafts(member, args.companyId) : [];
  const live = claimInfo(c, now, member.userId).state !== "free";
  return ok({
    company: {
      id: c.id,
      name: untrusted(c.name),
      industry: untrusted(c.industry),
      website: untrusted(c.website),
      notes: untrusted(c.notes),
      stage: c.stage,
      archived: c.archivedAt !== null,
      archivedAt: iso(c.archivedAt),
      lastContactedAt: iso(c.lastContactedAt),
      nextFollowUpAt: iso(c.nextFollowUpAt),
      claim: claimInfo(c, now, member.userId),
      claimedVia: live ? c.claimedVia : null,
    },
    contacts: c.contacts.map((p) => ({ id: p.id, name: untrusted(p.name), email: untrusted(p.email), title: untrusted(p.title) })),
    outreach: c.outreach.map((o) => ({
      id: o.id,
      sentAt: iso(o.sentAt),
      channel: o.channel,
      by: untrusted(o.sender.name),
      via: o.via,
      note: untrusted(o.note),
      gotReply: o.gotReply,
      template: untrusted(o.template?.name),
      aiDrafted: o.aiDraftId !== null,
    })),
    stageChanges: c.stageChanges.map((s) => ({ changedAt: iso(s.changedAt), from: s.fromStage, to: s.toStage, by: untrusted(s.changedBy.name), via: s.via })),
    totals: { outreach: c.outreachTotal, stageChanges: c.stageChangeTotal },
    openLookAlikes: lookAlikes.map((l) => ({ id: l.id, name: untrusted(l.name) })),
    latestBrief: brief
      ? {
          id: brief.id,
          createdAt: iso(brief.createdAt),
          items: brief.items.map((i) => ({
            id: i.id,
            door: i.door,
            title: untrusted(i.title),
            detail: untrusted(i.detail),
            deadline: untrusted(i.deadline),
            quote: untrusted(i.quote),
            url: untrusted(i.url),
            accepted: i.accepted,
          })),
        }
      : null,
    yourRecentDrafts: drafts.map((d) => ({ id: d.id, kind: d.kind, angle: untrusted(d.angle), subject: untrusted(d.subject), body: untrusted(d.body), createdAt: iso(d.createdAt) })),
  });
}

export async function getFollowUpQueue(principal: McpPrincipal, args: z.infer<typeof mcpQueueSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const queue = await getQueue(member, { mine: args.onlyMine ?? false, never: args.includeNeverContacted ?? false, all: null }, undefined, offset);
  const row = (c: QueueRow) => ({
    id: c.id,
    name: untrusted(c.name),
    nextFollowUpAt: iso(c.nextFollowUpAt),
    claim: claimInfo(c, queue.now, member.userId),
    lastNote: untrusted(c.lastNote),
  });
  const more = offset + queue.due.length < queue.dueCount || (queue.never !== null && offset + queue.never.length < queue.neverCount);
  return ok({
    now: iso(queue.now),
    due: queue.due.map(row),
    dueCount: queue.dueCount,
    neverContacted: queue.never?.map(row),
    neverContactedCount: queue.neverCount,
    yoursNotDue: queue.yoursNotDue,
    ...moreFields(more, offset, MCP_LIST_LIMIT, "Both lists move on together."),
  });
}

export async function listMyClaims(principal: McpPrincipal, args: z.infer<typeof mcpListMyClaimsSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const now = await dbNow();
  const rows = await withTenant(member, (tx) =>
    tx.company.findMany({
      where: { workspaceId: member.workspaceId, archivedAt: null, ...heldBy(member.userId, now) },
      select: { id: true, name: true, stage: true, claimExpiresAt: true, nextFollowUpAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: MCP_LIST_LIMIT + 1,
    }),
  );
  return ok({
    claims: rows
      .slice(0, MCP_LIST_LIMIT)
      .map((c) => ({ id: c.id, name: untrusted(c.name), stage: c.stage, heldUntil: iso(c.claimExpiresAt), nextFollowUpAt: iso(c.nextFollowUpAt) })),
    ...moreFields(rows.length > MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Claims are listed by company name."),
  });
}

// ----- Actions (need the coppice:write scope) -----

export async function claimCompanyTool(principal: McpPrincipal, args: z.infer<typeof mcpCompanySchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const result = await claimCompany(gate.member, args.companyId, "ASSISTANT");
  return fromResult(result, async (data) => {
    await recordActivity(principal, gate.member, { tool: "claim_company", action: "claimed", companyId: args.companyId });
    return ok({ claimed: true, heldUntil: iso(data.claimExpiresAt) });
  });
}

export async function logOutreachTool(principal: McpPrincipal, args: z.infer<typeof mcpLogOutreachSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // A retry with the same clientKey is answered with the entry already logged and writes nothing,
  // so it leaves no second activity row either. Looked up before the call to tell the two apart.
  const replay = args.clientKey
    ? await withTenant(member, (tx) => tx.outreach.findFirst({ where: { workspaceId: member.workspaceId, clientKey: args.clientKey }, select: { id: true } }))
    : null;
  const result = await logOutreach(member, args.companyId, {
    channel: args.channel,
    note: args.note || null,
    followUpOn: args.followUpOn,
    templateId: args.templateId ?? null,
    clientKey: args.clientKey ?? null,
    via: "ASSISTANT",
  });
  if (!result.ok) return refusedBy(result.error);
  if (!replay) await recordActivity(principal, member, { tool: "log_outreach", action: "logged", companyId: args.companyId });
  return ok({ logged: true, outreachId: result.data.outreachId, followUpOn: args.followUpOn, ...(replay ? { replayed: true } : {}) });
}

export async function changeStageTool(principal: McpPrincipal, args: z.infer<typeof mcpChangeStageSchema>): Promise<ToolResult> {
  // The app asks "Move to Committed?" before these two; an assistant must pass confirm: true,
  // which it should only do after asking the person. Checked before the gate, so the "ask first"
  // round trip doesn't use up one of the person's actions for the minute.
  if (TERMINAL_STAGES.includes(args.stage) && args.confirm !== true) {
    return confirmNeeded("change_stage", `Moving a company to ${STAGE_LABELS[args.stage]} ends the pitch and releases the claim.`);
  }
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  // Reopening a closed pitch (out of Committed or Declined) needs the same confirm: it undoes an
  // outcome someone recorded. Nothing ran, so the action counted by the gate is given back.
  if (args.confirm !== true) {
    const company = await withTenant(gate.member, (tx) =>
      tx.company.findFirst({ where: { id: args.companyId, workspaceId: gate.member.workspaceId }, select: { stage: true } }),
    );
    if (company && TERMINAL_STAGES.includes(company.stage) && company.stage !== args.stage) {
      return confirmNeededLater(
        principal,
        "change_stage",
        `This company is ${STAGE_LABELS[company.stage]}, so moving it to ${STAGE_LABELS[args.stage]} reopens a closed pitch.`,
      );
    }
  }
  const result = await changeStage(gate.member, args.companyId, args.stage, "ASSISTANT");
  return fromResult(result, async (data) => {
    // Moving to the stage it is already at changes nothing, so it is not logged.
    if (data.changed) await recordActivity(principal, gate.member, { tool: "change_stage", action: "stage_changed", companyId: args.companyId });
    return ok({ changed: data.changed, from: data.fromStage, to: data.toStage });
  });
}
