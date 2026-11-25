import type { z } from "zod";
import type { Prisma, VersionField } from "@/generated/prisma/client";
import { literal } from "@/lib/board";
import { changeStage, claimCompany, dbNow, dbToday, forceRelease, heldBy, logOutreach, markReply, releaseClaim, setFollowUp } from "@/lib/claims";
import { restoreVersion } from "@/lib/restore-version";
import { archiveCompany, createCompany, getCompanyPage, unarchiveCompany, updateCompany, type CompanyFields, type SaveResult } from "@/lib/companies";
import { listDuplicateReview, markSeparate, resolveAsDuplicate } from "@/lib/company-pairs";
import { filterClauses } from "@/lib/copilot/query";
import { withTenant } from "@/lib/db";
import { recentDrafts } from "@/lib/drafts";
import { notFoundMessage } from "@/lib/messages";
import { getQueue, type QueueRow } from "@/lib/queue";
import { latestBrief } from "@/lib/research/brief";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { PREVIOUS_VERSION_MS } from "@/lib/previous-versions";
import { VERSION_GONE_ASSISTANT } from "@/lib/previous-versions-copy";
import { workspaceRow } from "@/lib/workspaces";
import {
  companyFieldsSchema,
  MCP_LIST_LIMIT,
  type mcpChangeStageSchema,
  type mcpCompanySchema,
  type mcpCreateCompanySchema,
  type mcpListCompaniesSchema,
  type mcpListDuplicatePairsSchema,
  type mcpListMyClaimsSchema,
  type mcpLogOutreachSchema,
  type mcpMarkReplySchema,
  type mcpQueueSchema,
  type mcpReleaseClaimSchema,
  type mcpRestorePreviousVersionSchema,
  type mcpResolveDuplicateSchema,
  type mcpSetCompanyArchivedSchema,
  type mcpSetFollowUpSchema,
  type mcpUpdateCompanySchema,
} from "@/lib/validation";
import {
  BAD_CURSOR,
  claimInfo,
  confirmNeeded,
  confirmNeededLater,
  decodeCursor,
  fail,
  formCheck,
  fromResult,
  iso,
  moreFields,
  ok,
  openCompany,
  openWorkspace,
  recordActivity,
  refusedBy,
  untrusted,
  type McpPrincipal,
  type ToolResult,
} from "./shared";

// Group C, companies and claims: finding companies, reading one, the follow-up queue, look-alike
// pairs, adding and editing a company, archiving, claims, outreach, replies, follow-ups and stages.
// Changes go through lib/claims.ts, lib/companies.ts and lib/company-pairs.ts, the same functions
// the app's actions call, so every rule the app keeps holds here too.

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
  const { company: c, lookAlikes, previousVersions } = page;
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
    // Values replaced in the last hour, with the ids restore_previous_version takes. Empty for an
    // archived company. Typed text and the replacer's display name are wrapped as untrusted.
    previousVersions: previousVersions.map((v) => ({
      id: v.id,
      contactId: v.contactId,
      field: v.field.toLowerCase(),
      value: untrusted(v.value),
      replacedAt: iso(v.replacedAt),
      restorableUntil: iso(new Date(v.replacedAt.getTime() + PREVIOUS_VERSION_MS)),
      replacedBy: untrusted(v.replacedByName),
      via: v.via,
    })),
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
          // Team inboxes the brief found (careers@ and the like), with the ids accept_brief_item takes.
          inboxes: brief.inboxes.map((i) => ({ id: i.id, address: untrusted(i.email), url: untrusted(i.url), accepted: i.accepted })),
          // The brief's other sections, each quoting the fetched page it links to. The ask's tier is
          // the verified fact's own text; `changed` means that fact was edited or unverified since
          // (it can't be added), `old` that it was last verified over a year ago.
          ties: brief.ties.map((t) => ({ id: t.id, title: untrusted(t.title), detail: untrusted(t.detail), quote: untrusted(t.quote), url: untrusted(t.url), accepted: t.accepted })),
          flags: brief.flags.map((f) => ({ id: f.id, kind: f.kind, title: untrusted(f.title), quote: untrusted(f.quote), url: untrusted(f.url), accepted: f.accepted })),
          hook: brief.hook ? { id: brief.hook.id, line: untrusted(brief.hook.line), quote: untrusted(brief.hook.quote), url: untrusted(brief.hook.url), accepted: brief.hook.accepted } : null,
          ask: brief.ask
            ? {
                id: brief.ask.id,
                tier: untrusted(brief.ask.factText),
                reason: untrusted(brief.ask.reason),
                quote: untrusted(brief.ask.quote),
                url: untrusted(brief.ask.url),
                accepted: brief.ask.accepted,
                changed: brief.ask.changed,
                old: brief.ask.old,
              }
            : null,
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

// ----- The rest of Group C -----

// Look-alikes, as the answer to a create or an edit that stopped to ask. Nothing was saved.
function lookAlikes(result: Extract<SaveResult, { status: "possible-duplicates" }>): ToolResult {
  return ok({
    saved: false,
    possibleDuplicates: result.matches.map((m) => ({ id: m.id, name: untrusted(m.name), website: untrusted(m.website), archived: m.archived, matchedOn: m.matchedOn })),
    total: result.total,
    next:
      "Nothing was saved. Show the person these look-alikes. If one is the company they mean, work with it instead, and bring an archived one back with set_company_archived. " +
      "Only after the person says these are different companies, call again with separateFrom set to these ids.",
  });
}

const pairSide = (c: { id: string; name: string; website: string | null }) => ({ id: c.id, name: untrusted(c.name), website: untrusted(c.website) });

export async function listDuplicatePairs(principal: McpPrincipal, args: z.infer<typeof mcpListDuplicatePairsSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  // The pairs are found newest to oldest group by group, so a page asks for everything up to its end.
  const pairs = await listDuplicateReview(gate.member, offset + MCP_LIST_LIMIT + 1);
  return ok({
    pairs: pairs.slice(offset, offset + MCP_LIST_LIMIT).map((p) => ({ a: pairSide(p.a), b: pairSide(p.b), matchedOn: p.matchedOn, suggestedKeepId: p.keepId })),
    ...moreFields(pairs.length > offset + MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Resolve some pairs with resolve_duplicate first."),
  });
}

export async function createCompanyTool(principal: McpPrincipal, args: z.infer<typeof mcpCreateCompanySchema>): Promise<ToolResult> {
  const fields = formCheck(companyFieldsSchema, { name: args.name, industry: args.industry ?? null, website: args.website ?? null, notes: args.notes ?? null });
  if (fields.refused) return fields.refused;
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const result = await createCompany(gate.member, fields.data, args.separateFrom ?? []);
  if (result.status === "possible-duplicates") return lookAlikes(result);
  if (result.status !== "saved") return fail("The company could not be saved.");
  await recordActivity(principal, gate.member, { tool: "create_company", action: "added", companyId: result.companyId });
  return ok({ saved: true, companyId: result.companyId });
}

const EDITABLE = ["name", "industry", "website", "notes"] as const;

export async function updateCompanyTool(principal: McpPrincipal, args: z.infer<typeof mcpUpdateCompanySchema>): Promise<ToolResult> {
  // The new values go through the app's own form schema (trimmed, an empty box is null). The old
  // values are compared exactly as stored, so they are not trimmed.
  const changes = formCheck(companyFieldsSchema.partial(), args.changes);
  if (changes.refused) return changes.refused;
  const named = EDITABLE.filter((f) => changes.data[f] !== undefined);
  if (named.length === 0) return fail("Say what to change, in changes.");
  for (const f of named) {
    if (args.original[f] === undefined) return fail(`Send the current ${f} in original, exactly as get_company returned it.`);
  }
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId);
  if (found.refused) return found.refused;

  // Fields the person did not name are the same on both sides, so the lib sees them as unchanged.
  const next: CompanyFields = { name: "", industry: null, website: null, notes: null };
  const old: CompanyFields = { ...next };
  for (const f of named) {
    const to = changes.data[f] ?? null;
    const from = args.original[f] ?? null;
    if (f === "name") {
      next.name = to ?? "";
      old.name = from ?? "";
    } else {
      next[f] = to;
      old[f] = from || null;
    }
  }
  const edit = { changes: next, original: old };
  if (named.every((f) => (next[f] ?? null) === (old[f] ?? null))) return ok({ saved: true, changed: false, companyId: args.companyId });

  const result = await updateCompany(member, args.companyId, edit, args.separateFrom ?? [], "ASSISTANT");
  return fromResult(result, async (data) => {
    if (data.status === "possible-duplicates") return lookAlikes(data);
    if (data.status === "conflict") {
      return ok({
        saved: false,
        conflicts: data.conflicts.map((c) => ({ field: c.field, theirs: untrusted(c.theirs), yours: untrusted(c.yours) })),
        next: "Nothing was saved. Someone changed this company after you read it. Show the person both values and ask what to keep, then read the company again with get_company.",
      });
    }
    await recordActivity(principal, member, { tool: "update_company", action: "updated", companyId: args.companyId });
    return ok({ saved: true, changed: true, companyId: args.companyId });
  });
}

export async function restorePreviousVersionTool(principal: McpPrincipal, args: z.infer<typeof mcpRestorePreviousVersionSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId);
  if (found.refused) return found.refused;
  const result = await restoreVersion(member, { companyId: args.companyId, versionId: args.versionId, expect: { value: args.current }, subject: args.field ? { field: args.field.toUpperCase() as VersionField, contactId: args.contactId ?? null } : undefined, separateFrom: args.separateFrom ?? [] }, "ASSISTANT");
  return fromResult(result, async (data) => {
    if (data.status === "gone") return fail(`${VERSION_GONE_ASSISTANT} Read the company again with get_company.`);
    if (data.status === "changed") return fail("The field changed after you read it, so nothing was restored. Read the company again with get_company and ask the person what to keep.");
    if (data.status === "possible-duplicates") return lookAlikes(data);
    if (data.status === "unchanged") return ok({ restored: false, changed: false });
    await recordActivity(principal, member, { tool: "restore_previous_version", action: "updated", companyId: args.companyId, targetId: data.contactId });
    return ok({
      restored: true,
      field: data.field.toLowerCase(),
      contactId: data.contactId,
      note: "The value it replaced is now the previous version, kept for an hour, so this can be undone the same way.",
    });
  });
}

export async function setCompanyArchivedTool(principal: McpPrincipal, args: z.infer<typeof mcpSetCompanyArchivedSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const found = await openCompany(member, args.companyId, { allowArchived: true });
  if (found.refused) return found.refused;
  // Already where the person wants it: nothing changes, so nothing is logged.
  if ((found.company.archivedAt !== null) === args.archived) return ok({ archived: args.archived, changed: false });
  const result = args.archived ? await archiveCompany(member, args.companyId) : await unarchiveCompany(member, args.companyId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "set_company_archived", action: args.archived ? "archived" : "unarchived", companyId: args.companyId });
    return ok({ archived: args.archived, changed: true });
  });
}

export async function resolveDuplicateTool(principal: McpPrincipal, args: z.infer<typeof mcpResolveDuplicateSchema>): Promise<ToolResult> {
  if (args.decision === "same" && args.keepId !== args.companyId && args.keepId !== args.otherId) {
    return fail("For same, send keepId: the id of the company to keep, companyId or otherId.");
  }
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.decision === "separate") {
    const result = await markSeparate(member, args.companyId, args.otherId);
    return fromResult(result, async () => {
      await recordActivity(principal, member, { tool: "resolve_duplicate", action: "kept_separate", companyId: args.companyId });
      return ok({ decision: "separate", note: "Remembered. These two are no longer flagged as look-alikes." });
    });
  }
  const archiveId = args.keepId === args.companyId ? args.otherId : args.companyId;
  const result = await resolveAsDuplicate(member, args.keepId as string, archiveId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "resolve_duplicate", action: "archived_duplicate", companyId: archiveId });
    return ok({ decision: "same", kept: args.keepId, archived: archiveId, note: "Nothing was merged: the archived company keeps its contacts and history. set_company_archived brings it back." });
  });
}

export async function releaseClaimTool(principal: McpPrincipal, args: z.infer<typeof mcpReleaseClaimSchema>): Promise<ToolResult> {
  const force = args.force === true;
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: force });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (force && args.confirm !== true) {
    return confirmNeededLater(principal, "release_claim", "Releasing someone else's claim lets anyone claim the company, and the person who held it is not told.");
  }
  const result = force ? await forceRelease(member, args.companyId) : await releaseClaim(member, args.companyId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "release_claim", action: force ? "force_released" : "released", companyId: args.companyId });
    return ok({ released: true });
  });
}

export async function markReplyTool(principal: McpPrincipal, args: z.infer<typeof mcpMarkReplySchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Marking an entry that is already marked is fine and changes nothing, so it is not logged again.
  const before = await withTenant(member, (tx) =>
    tx.outreach.findFirst({ where: { id: args.outreachId, companyId: args.companyId, workspaceId: member.workspaceId }, select: { gotReply: true } }),
  );
  const result = await markReply(member, args.companyId, args.outreachId);
  return fromResult(result, async () => {
    if (!before?.gotReply) await recordActivity(principal, member, { tool: "mark_reply", action: "replied", companyId: args.companyId });
    return ok({ marked: true });
  });
}

export async function setFollowUpTool(principal: McpPrincipal, args: z.infer<typeof mcpSetFollowUpSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // setFollowUp takes via but has no history row to write it on, so the activity row is the record.
  const result = await setFollowUp(member, args.companyId, args.followUpOn, "ASSISTANT");
  return fromResult(result, async (data) => {
    await recordActivity(principal, member, { tool: "set_follow_up", action: "follow_up_set", companyId: args.companyId });
    return ok({ followUpOn: args.followUpOn, nextFollowUpAt: iso(data.nextFollowUpAt) });
  });
}
