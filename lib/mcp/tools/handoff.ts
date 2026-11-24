import type { z } from "zod";
import { aiUsage } from "@/lib/ai/run";
import {
  applyCalendar,
  approveCard,
  approveRest,
  buildCodeCards,
  currentBoardYear,
  EVERYONE_MARKED,
  NONE_MARKED,
  departingSummary,
  fillBlankDates,
  listMembers as listOwnerMembers,
  listYears,
  loadCalendar,
  loadPlaybook,
  loadRecap,
  memberView,
  ownerView,
  publishReport,
  releaseDepartingClaims,
  reopenForNextYear,
  saveRecontactDates,
  setDeparting,
  setHidden,
  startReport,
  unpublishReport,
  type CardView,
  type MemberCard,
  type Playbook,
  type Recap,
} from "@/lib/capsule";
import type { CardFacts } from "@/lib/capsule/types";
import { withTenant } from "@/lib/db";
import { returnMcpCall } from "@/lib/mcp/rate-limit";
import {
  MCP_LIST_LIMIT,
  type mcpApplyHandoffCalendarSchema,
  type mcpApproveRemainingCardsSchema,
  type mcpBuildHandoffCardsSchema,
  type mcpFillBlankDatesSchema,
  type mcpGetHandoffSchema,
  type mcpReleaseDepartingClaimsSchema,
  type mcpReopenForNextYearSchema,
  type mcpReviewHandoffCardSchema,
  type mcpSaveRecontactDatesSchema,
  type mcpSetDepartingSchema,
  type mcpSetHandoffPublishedSchema,
  type mcpStartHandoffSchema,
} from "@/lib/validation";
import { ratedOut, templateLineOut } from "./stats";
import {
  BAD_CURSOR,
  confirmNeededLater,
  decodeCursor,
  fail,
  fromResult,
  moreFields,
  ok,
  openWorkspace,
  recordActivity,
  refusedBy,
  untrusted,
  iso,
  type McpPrincipal,
  type ToolResult,
} from "./shared";

// Group H, the year-end handoff: the same six steps the Time Capsule page walks an owner through,
// one call each, minus the one step that needs a model (reading notes into bullets with Groq),
// which stays in the app. build_handoff_cards makes the plain, facts-only cards instead. Every
// handoff step is an owner's; get_handoff also gives every member the published handoff and the
// year's numbers, as the page does. The lib functions check the owner again. Steps that change a
// company or reach the whole team need confirm.

// Every name and line of text on a card was typed by a member, or is quoted from what they typed.
const factsOut = (facts: CardFacts) => ({
  stage: facts.stage,
  outreachCount: facts.outreachCount,
  replies: facts.replies,
  firstContactAt: facts.firstContactAt,
  lastContactAt: facts.lastContactAt,
  senders: facts.senders.map((s) => ({ name: untrusted(s.name), count: s.count })),
  replyTemplates: facts.replyTemplates.map((t) => untrusted(t)),
  contacts: facts.contacts.map((c) => ({ name: untrusted(c.name), title: untrusted(c.title) })),
});

const bulletOut = (b: { section: string; text: string; quote: string; month: number | null }) => ({
  section: b.section,
  text: untrusted(b.text),
  quote: untrusted(b.quote),
  month: b.month,
});

const ownerCardOut = (card: CardView) => ({
  cardId: card.id,
  companyId: card.companyId,
  companyName: untrusted(card.companyName),
  source: card.source,
  facts: factsOut(card.facts),
  bullets: card.bullets.map((b) => ({ index: b.index, hidden: b.hidden, ...bulletOut(b) })),
  hidden: card.hidden,
  approved: card.approved,
  recontactOn: card.recontactOn,
});

const memberCardOut = (card: MemberCard) => ({
  cardId: card.id,
  companyId: card.companyId,
  companyName: untrusted(card.companyName),
  stage: card.stage,
  facts: factsOut(card.facts),
  bullets: card.bullets.map(bulletOut),
  recontactOn: card.recontactOn,
});

const recapOut = (recap: Recap) => ({
  year: recap.year,
  empty: recap.empty,
  team: {
    ...recap.team,
    longestThread: recap.team.longestThread ? { ...recap.team.longestThread, name: untrusted(recap.team.longestThread.name) } : null,
    fastestReply: recap.team.fastestReply ? { ...recap.team.fastestReply, name: untrusted(recap.team.fastestReply.name) } : null,
    bestTemplate: recap.team.bestTemplate ? { ...recap.team.bestTemplate, name: untrusted(recap.team.bestTemplate.name) } : null,
  },
  you: recap.you,
});

const playbookOut = (book: Playbook) => ({
  year: book.year,
  monthWithMostReplies: book.monthWithMostReplies,
  touchesBeforeReply: book.touchesBeforeReply,
  daysToReply: book.daysToReply,
  bestTemplate: book.best ? templateLineOut(book.best) : null,
  worstTemplate: book.worst ? templateLineOut(book.worst) : null,
  ratedTemplates: book.rated,
  retiredTemplateDidBetter: book.retiredBetter ? { name: untrusted(book.retiredBetter.name), replyRate: book.retiredBetter.rate } : null,
  byTouch: book.byTouch.map((p) => ({ label: p.label, ...ratedOut(p.stat) })),
  emailAuthorship: { aiDrafted: ratedOut(book.authorship.ai), handWritten: ratedOut(book.authorship.hand), ahead: book.authorship.lead },
});

// What an owner sees of a board year's handoff, and what an officer sees of the published one.
export async function getHandoffTool(principal: McpPrincipal, args: z.infer<typeof mcpGetHandoffSchema>): Promise<ToolResult> {
  const offset = decodeCursor(args.cursor);
  if (offset === null) return fail(BAD_CURSOR);
  const gate = await openWorkspace(principal, args.workspaceId, "read");
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const isOwner = member.role === "owner";
  const current = await currentBoardYear();
  const year = args.boardYearStart ?? current;
  const years = await listYears(member);
  const base = {
    year: { boardYearStart: year, isCurrent: year === current },
    handoffYears: years.map((y) => ({ boardYearStart: y.boardYearStart, label: y.label, status: y.status === "PUBLISHED" ? "published" : "draft", publishedAt: y.publishedAt })),
  };
  // The year's numbers come once, with the first page.
  const recap = offset === 0 ? recapOut(await loadRecap(member, year)) : undefined;

  if (!isOwner) {
    const view = await memberView(member, year);
    if (!view) return ok({ ...base, ...(recap ? { recap } : {}), handoff: null, note: "No handoff is published for this board year. An owner publishes it in Coppice." });
    const cards = view.cards.slice(offset, offset + MCP_LIST_LIMIT);
    return ok({
      ...base,
      ...(recap ? { recap } : {}),
      handoff: { reportId: view.report.id, label: view.report.label, status: "published", publishedAt: view.report.publishedAt, cards: cards.map(memberCardOut) },
      ...moreFields(view.cards.length > offset + MCP_LIST_LIMIT, offset, MCP_LIST_LIMIT, "Cards are listed in the order the handoff set."),
    });
  }

  const viewed = await ownerView(member, year);
  if (!viewed.ok) return refusedBy(viewed.error);
  const view = viewed.data;
  if (!view) {
    return ok({ ...base, ...(recap ? { recap } : {}), handoff: null, note: "No handoff has been started for this board year. Call start_handoff to start it." });
  }
  const reportId = view.report.id;
  const calendar = await loadCalendar(member, reportId);
  const rows = calendar.ok ? calendar.data : [];
  // The leaving marks belong to the current board year's turnover only, so a past year shows none.
  const isCurrent = year === current;
  const people = isCurrent ? await listOwnerMembers(member) : null;
  const leaving = people?.ok ? people.data.filter((m) => m.departingAt !== null) : [];
  const book = offset === 0 ? await loadPlaybook(member, year) : null;
  const cards = view.cards.slice(offset, offset + MCP_LIST_LIMIT);
  const dated = rows.filter((r) => r.date !== null).length;
  const hasMore = view.cards.length > offset + MCP_LIST_LIMIT || rows.length > offset + MCP_LIST_LIMIT;
  return ok({
    ...base,
    ...(recap ? { recap } : {}),
    handoff: {
      reportId,
      label: view.report.label,
      status: view.report.status === "PUBLISHED" ? "published" : "draft",
      createdAt: view.report.createdAt,
      publishedAt: view.report.publishedAt,
      // Where each step stands, in the order of the page.
      steps: {
        ...(isCurrent ? { leaving: { markedAsLeaving: leaving.length, claimsTheyHold: leaving.reduce((n, m) => n + m.claims, 0) } } : {}),
        cards: { companies: view.report.companies, withACard: view.counts.cards, withoutACard: Math.max(0, view.report.companies - view.counts.cards), aiOn: view.ai.on },
        review: { approved: view.counts.approved, hidden: view.counts.hidden, waiting: view.counts.pending },
        dates: { approvedCards: rows.length, withADate: dated, blank: rows.length - dated },
        published: view.report.status === "PUBLISHED",
      },
      ...(isCurrent ? {} : { leavingNote: "Who is leaving is only shown for the current board year. Call list_members to see who is marked now." }),
      ...(offset === 0 && isCurrent ? { leavingMembers: leaving.map((m) => ({ userId: m.userId, name: untrusted(m.name), claimsHeld: m.claims })) } : {}),
      cards: cards.map(ownerCardOut),
      calendar: rows.slice(offset, offset + MCP_LIST_LIMIT).map((r) => ({
        cardId: r.cardId,
        companyId: r.companyId,
        name: untrusted(r.name),
        stage: r.stage,
        proposedDate: r.proposed,
        savedDate: r.date,
        currentFollowUp: r.followUp,
        closed: r.closed,
      })),
      ...(book ? { playbook: playbookOut(book) } : {}),
    },
    ...moreFields(hasMore, offset, MCP_LIST_LIMIT, "Cards and calendar rows are listed in the handoff's order."),
  });
}

export async function setDepartingTool(principal: McpPrincipal, args: z.infer<typeof mcpSetDepartingSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Only the leaving mark changes: nobody's access, role or membership. The write itself decides
  // whether anything changed, so identical calls at the same moment record one row.
  const result = await setDeparting(member, args.userId, args.departing);
  return fromResult(result, async ({ changed }) => {
    if (!changed) return ok({ userId: args.userId, departing: args.departing, changed: false });
    await recordActivity(principal, member, { tool: "set_departing", action: args.departing ? "departing_set" : "departing_cleared", targetId: args.userId });
    return ok({ userId: args.userId, departing: args.departing, changed: true, note: "Nobody lost access. The mark only says whose claims release_departing_claims gives back." });
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// How many released companies the answer lists. The rest are counted, so the answer stays small.
const RELEASED_LISTED = 200;

export async function releaseDepartingClaimsTool(principal: McpPrincipal, args: z.infer<typeof mcpReleaseDepartingClaimsSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // Say what it would do before asking. The refusals below change nothing, so they give the call back.
  const looked = await departingSummary(member);
  if (!looked.ok) return refusedBy(looked.error);
  const now = looked.data;
  if (now.marked === 0 || now.companies === 0) {
    await returnMcpCall(principal.userId, "action");
    return ok({
      released: 0,
      people: [],
      companies: [],
      note: now.marked === 0 ? "No member is marked as leaving, so there is nothing to give back. Mark members with set_departing first." : "The members marked as leaving hold no companies, so there is nothing to give back.",
    });
  }
  // Over MCP only: marking everyone and then releasing is never a real handoff. The app's own release still works.
  if (now.everyoneMarked) {
    await returnMcpCall(principal.userId, "action");
    return fail(EVERYONE_MARKED);
  }
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "release_departing_claims",
      `This gives back ${plural(now.companies, "company", "companies")} held by ${plural(now.marked, "member", "members")} marked as leaving. Call list_members to see who.${now.callerMarked ? " You are marked as leaving too, so your own claims are included." : ""}`,
    );
  }
  const result = await releaseDepartingClaims(member, { refuseWhenEveryone: true });
  // Decided inside the release, after the lock, so nothing was freed: give the call back and answer
  // exactly as the early checks above do.
  if (!result.ok && result.error === EVERYONE_MARKED) {
    await returnMcpCall(principal.userId, "action");
    return fail(EVERYONE_MARKED);
  }
  if (!result.ok && result.error === NONE_MARKED) {
    await returnMcpCall(principal.userId, "action");
    return ok({ released: 0, people: [], companies: [], note: "No member is marked as leaving, so there is nothing to give back. Mark members with set_departing first." });
  }
  return fromResult(result, async (data) => {
    if (data.released > 0) await recordActivity(principal, member, { tool: "release_departing_claims", action: "claims_released" });
    return ok({
      released: data.released,
      people: data.people.map((p) => ({ userId: p.userId, name: untrusted(p.name), released: p.released })),
      companies: data.companies.slice(0, RELEASED_LISTED).map((c) => ({ companyId: c.id, name: untrusted(c.name), previousHolderId: c.previousHolderId })),
      ...(data.companies.length > RELEASED_LISTED ? { companiesNotListed: data.companies.length - RELEASED_LISTED } : {}),
    });
  });
}

export async function startHandoffTool(principal: McpPrincipal, args: z.infer<typeof mcpStartHandoffSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const year = args.boardYearStart ?? (await currentBoardYear());
  const result = await startReport(member, year);
  return fromResult(result, async (data) => {
    // Picking up a handoff that already exists changes nothing.
    if (!data.resumed) await recordActivity(principal, member, { tool: "start_handoff", action: "started", targetId: data.reportId });
    return ok({
      reportId: data.reportId,
      boardYearStart: data.boardYearStart,
      label: data.label,
      status: data.status === "PUBLISHED" ? "published" : "draft",
      companies: data.companies,
      alreadyStarted: data.resumed,
      next: "Companies past the first 60 already have plain cards. Call build_handoff_cards for the rest, then review the cards with get_handoff.",
    });
  });
}

const PLAIN_CARDS = "This makes plain cards from the facts for every company that has no card yet. After this, Coppice's AI has nothing left to read for this handoff.";

export async function buildHandoffCardsTool(principal: McpPrincipal, args: z.infer<typeof mcpBuildHandoffCardsSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  // With AI off nobody could have read the notes anyway, so there is nothing to give up.
  if ((await aiUsage(member)).enabled && args.confirm !== true) return confirmNeededLater(principal, "build_handoff_cards", PLAIN_CARDS);
  const result = await buildCodeCards(member, args.reportId);
  return fromResult(result, async (data) => {
    if (data.created > 0) await recordActivity(principal, member, { tool: "build_handoff_cards", action: "cards_built", targetId: args.reportId });
    return ok({ created: data.created, note: "These cards hold facts only, with no bullets. Review them with review_handoff_card or approve them with approve_remaining_cards." });
  });
}

export async function reviewHandoffCardTool(principal: McpPrincipal, args: z.infer<typeof mcpReviewHandoffCardSchema>): Promise<ToolResult> {
  if (args.hidden === undefined && args.approve === undefined) return fail("Say what to do: send hidden (true or false), approve: true, or both.");
  if (args.bulletIndex !== undefined && args.hidden === undefined) return fail("bulletIndex goes with hidden. Approval is for the whole card.");
  if (args.approve && args.hidden === true && args.bulletIndex === undefined) return fail("A hidden card cannot be approved. Hide it or approve it, not both.");
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const card = await withTenant(member, (tx) =>
    tx.relationshipCard.findFirst({
      where: { id: args.cardId, workspaceId: member.workspaceId },
      select: { approvedAt: true, redactions: { select: { bulletIndex: true } } },
    }),
  );
  const hiddenNow = card?.redactions.some((r) => r.bulletIndex === (args.bulletIndex ?? null)) ?? false;
  let changed = false;
  if (args.hidden !== undefined) {
    const result = await setHidden(member, args.cardId, args.bulletIndex ?? null, args.hidden);
    if (!result.ok) return refusedBy(result.error);
    changed = hiddenNow !== args.hidden;
  }
  if (args.approve) {
    const result = await approveCard(member, args.cardId);
    if (!result.ok) {
      if (changed) await recordActivity(principal, member, { tool: "review_handoff_card", action: "card_reviewed", targetId: args.cardId });
      return refusedBy(result.error);
    }
    changed = changed || card?.approvedAt === null;
  }
  if (changed) await recordActivity(principal, member, { tool: "review_handoff_card", action: "card_reviewed", targetId: args.cardId });
  return ok({
    cardId: args.cardId,
    changed,
    ...(args.hidden !== undefined ? { hidden: args.hidden, ...(args.bulletIndex !== undefined ? { bulletIndex: args.bulletIndex } : {}) } : {}),
    ...(args.approve ? { approved: true } : {}),
  });
}

export async function approveRemainingCardsTool(principal: McpPrincipal, args: z.infer<typeof mcpApproveRemainingCardsSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "approve_remaining_cards",
      "This approves every card that is not hidden and not yet approved, so officers will read them once the handoff is published. It skips reading them one by one, and an approval cannot be taken back (a card can only be hidden).",
    );
  }
  const result = await approveRest(member, args.reportId);
  return fromResult(result, async (data) => {
    if (data.approved > 0) await recordActivity(principal, member, { tool: "approve_remaining_cards", action: "cards_approved", targetId: args.reportId });
    return ok({ approved: data.approved });
  });
}

export async function saveRecontactDatesTool(principal: McpPrincipal, args: z.infer<typeof mcpSaveRecontactDatesSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const result = await saveRecontactDates(member, args.reportId, args.dates);
  return fromResult(result, async (data) => {
    if (data.saved > 0) await recordActivity(principal, member, { tool: "save_recontact_dates", action: "dates_saved", targetId: args.reportId });
    return ok({ saved: data.saved, refused: data.refused, note: "These are planned dates. They reach the companies only when apply_handoff_calendar runs." });
  });
}

export async function fillBlankDatesTool(principal: McpPrincipal, args: z.infer<typeof mcpFillBlankDatesSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  const result = await fillBlankDates(member, args.reportId, args.date);
  return fromResult(result, async (data) => {
    if (data.set > 0) await recordActivity(principal, member, { tool: "fill_blank_dates", action: "dates_filled", targetId: args.reportId });
    return ok({ set: data.set });
  });
}

export async function applyHandoffCalendarTool(principal: McpPrincipal, args: z.infer<typeof mcpApplyHandoffCalendarSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "apply_handoff_calendar",
      "This puts each saved re-contact date on its company as the next follow-up, overwriting the date it has now. Many companies change at once, everyone's queue shifts, and the old dates are not kept.",
    );
  }
  const result = await applyCalendar(member, args.reportId, "ASSISTANT");
  return fromResult(result, async (data) => {
    if (data.set.length > 0) await recordActivity(principal, member, { tool: "apply_handoff_calendar", action: "calendar_applied", targetId: args.reportId });
    return ok({
      set: data.set.map((s) => ({ companyId: s.companyId, name: untrusted(s.name), date: s.date })),
      refused: data.refused.map((r) => ({ companyId: r.companyId, name: untrusted(r.name), reason: untrusted(r.reason) })),
      cardsWithoutADate: data.blank,
      committedCompaniesSkipped: data.skippedClosed,
    });
  });
}

export async function reopenForNextYearTool(principal: McpPrincipal, args: z.infer<typeof mcpReopenForNextYearSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "reopen_for_next_year",
      "This moves one Committed company back to Contacted so it can be pitched again. It reopens a closed deal and is recorded in the company's history as made through an assistant.",
    );
  }
  const result = await reopenForNextYear(member, args.cardId, "ASSISTANT");
  return fromResult(result, async (data) => {
    await recordActivity(principal, member, { tool: "reopen_for_next_year", action: "reopened", companyId: data.companyId });
    return ok({ companyId: data.companyId, name: untrusted(data.name), stage: "CONTACTED" });
  });
}

export async function setHandoffPublishedTool(principal: McpPrincipal, args: z.infer<typeof mcpSetHandoffPublishedSchema>): Promise<ToolResult> {
  const gate = await openWorkspace(principal, args.workspaceId, "action", { owner: true });
  if (gate.refused) return gate.refused;
  const { member } = gate;
  if (args.published && args.confirm !== true) {
    return confirmNeededLater(
      principal,
      "set_handoff_published",
      "Publishing shows every member the approved cards, the playbook and the re-contact calendar of this handoff, including text taken from the team's notes.",
    );
  }
  const report = await withTenant(member, (tx) => tx.handoffReport.findFirst({ where: { id: args.reportId, workspaceId: member.workspaceId }, select: { status: true, publishedAt: true } }));
  if (report && (report.status === "PUBLISHED") === args.published) return ok({ reportId: args.reportId, published: args.published, changed: false, publishedAt: iso(report.publishedAt) });
  const result = args.published ? await publishReport(member, args.reportId) : await unpublishReport(member, args.reportId);
  return fromResult(result, async () => {
    await recordActivity(principal, member, { tool: "set_handoff_published", action: args.published ? "published" : "unpublished", targetId: args.reportId });
    return ok({ reportId: args.reportId, published: args.published, changed: true });
  });
}
