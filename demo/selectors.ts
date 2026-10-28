import { DEFAULT_BOARD_FILTERS, DEFAULT_COMPANIES_FILTERS, DEFAULT_QUEUE_FILTERS, type BoardFilters, type CompaniesFilters, type QueueFilters } from "./routes";
import { addDaysYmd, daysOverdue, dueLabel, formatDay, formatWhen, localYmd, overdueLabel } from "./dates";
import { personName } from "./engine-core";
import { MAX_FOLLOW_UP_DAYS, DEFAULT_FOLLOW_UP_DAYS } from "./engine-claims";
import { matchReasons, orderedPair, claimStateOf, factNumbers, isFactStale, type RuleContext } from "./rules";
import {
  CHANNEL_LABELS,
  REPLY_STAGES,
  STAGES,
  STAGE_LABELS,
  isTerminalStage,
  type ClaimState,
  type Company,
  type Contact,
  type DemoState,
  type Draft,
  type Fact,
  type FactSheetFile,
  type Invitation,
  type InvitationForMe,
  type IsoDateTime,
  type MatchReason,
  type Member,
  type Outreach,
  type Person,
  type Role,
  type Stage,
  type StageChange,
  type Template,
  type Workspace,
  ROLE_LABELS,
} from "./types";
import { AI_WINDOW_DAYS, COLUMN_SIZE, DUPLICATE_PAIR_LIMIT, QUEUE_SIZE, SHOW_ALL_LIMIT } from "./validation";

// Read-only views of the state, one per screen. Each is a pure function of the state, so it can be
// called in a render, a test or a script. The hooks in demo/store.tsx wrap these.

// ----- Small shared pieces -----

export type ClaimView = {
  state: ClaimState;
  holderId: string | null;
  holderName: string | null;
  expiresAt: IsoDateTime | null;
  // "Yours until Nov 11", "Held by Sam Lee until Nov 11", "Sam Lee's claim expired Oct 20", "Not claimed".
  label: string;
  // Whole days until the claim runs out, for a live claim. Zero or less once it has.
  daysLeft: number | null;
};

export function claimView(state: DemoState, company: Pick<Company, "claimedById" | "claimExpiresAt">): ClaimView {
  const claimState = claimStateOf(company, state.now, state.meId);
  const holderName = company.claimedById ? personName(state, company.claimedById) : null;
  const expiresAt = company.claimExpiresAt;
  const until = expiresAt ? formatDay(expiresAt) : "";
  const label =
    claimState === "mine"
      ? `Yours until ${until}`
      : claimState === "theirs"
        ? `Held by ${holderName} until ${until}`
        : claimState === "expired"
          ? `${holderName}'s claim expired ${until}`
          : "Not claimed";
  const daysLeft = expiresAt && (claimState === "mine" || claimState === "theirs") ? Math.floor((Date.parse(expiresAt) - Date.parse(state.now)) / 86_400_000) : null;
  return { state: claimState, holderId: company.claimedById, holderName, expiresAt, label, daysLeft };
}

const byName = (a: Company, b: Company) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const time = (iso: string | null) => (iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso));

const inWorkspace = (state: DemoState, ws: string) => state.companies.filter((c) => c.workspaceId === ws);
const isOpen = (c: Company) => c.archivedAt === null && !isTerminalStage(c.stage);

export const workspaceById = (state: DemoState, ws: string): Workspace | undefined => state.workspaces.find((w) => w.id === ws);
export const myMembership = (state: DemoState, ws: string): Member | undefined => state.members.find((m) => m.workspaceId === ws && m.userId === state.meId);
export const personById = (state: DemoState, id: string): Person | undefined => state.people.find((p) => p.id === id);
export const me = (state: DemoState): Person => personById(state, state.meId) as Person;

// ----- Who am I, here -----

export type MeInWorkspace = { person: Person; role: Role | null; roleLabel: string | null; isOwner: boolean; isMember: boolean };

export function selectMe(state: DemoState, ws: string): MeInWorkspace {
  const role = myMembership(state, ws)?.role ?? null;
  return { person: me(state), role, roleLabel: role ? ROLE_LABELS[role] : null, isOwner: role === "owner", isMember: role !== null };
}

// ----- The workspace list -----

export type WorkspaceCard = {
  workspace: Workspace;
  role: Role;
  roleLabel: string;
  memberCount: number;
  companyCount: number;
  dueCount: number;
  // Companies I hold with a live claim.
  myClaims: number;
};

export type WorkspaceList = {
  me: Person;
  workspaces: WorkspaceCard[];
  invitations: InvitationForMe[];
  canCreate: boolean;
  // Signed in with no workspace and no invitation: "No workspace is linked to <email>".
  nothingHere: boolean;
};

export function selectWorkspaceList(state: DemoState): WorkspaceList {
  const mine = state.members
    .filter((m) => m.userId === state.meId)
    .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))
    .flatMap((m) => {
      const workspace = workspaceById(state, m.workspaceId);
      return workspace ? [{ workspace, member: m }] : [];
    });
  const workspaces = mine.map(({ workspace, member }): WorkspaceCard => {
    const companies = inWorkspace(state, workspace.id).filter((c) => c.archivedAt === null);
    return {
      workspace,
      role: member.role,
      roleLabel: ROLE_LABELS[member.role],
      memberCount: state.members.filter((x) => x.workspaceId === workspace.id).length,
      companyCount: companies.length,
      dueCount: companies.filter((c) => isOpen(c) && c.nextFollowUpAt !== null && time(c.nextFollowUpAt) <= Date.parse(state.now)).length,
      myClaims: companies.filter((c) => claimStateOf(c, state.now, state.meId) === "mine").length,
    };
  });
  return {
    me: me(state),
    workspaces,
    invitations: state.invitationsForMe,
    canCreate: state.canCreateWorkspace,
    nothingHere: workspaces.length === 0 && state.invitationsForMe.length === 0,
  };
}

// ----- The queue -----

export type QueueRow = {
  company: Company;
  claim: ClaimView;
  // "5 days overdue", "Due today", or "No outreach yet" for a fresh lead.
  timing: string;
  // Whole calendar days past the follow-up date, null for a fresh lead.
  daysOverdue: number | null;
  contact: Contact | null;
  lastNote: string | null;
  // The button that fits: claim it, or log outreach on it, or nothing when someone else holds it.
  action: "claim" | "log-outreach" | "none";
};

export type Queue = {
  now: IsoDateTime;
  filters: QueueFilters;
  due: QueueRow[];
  dueCount: number;
  // Null while the Never contacted section is collapsed.
  never: QueueRow[] | null;
  neverCount: number;
  hasMoreDue: boolean;
  hasMoreNever: boolean;
};

function latestNotes(state: DemoState, ws: string): Map<string, string> {
  const notes = new Map<string, string>();
  const rows = state.outreach
    .filter((o) => o.workspaceId === ws && o.note)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.id.localeCompare(b.id));
  for (const o of rows) if (!notes.has(o.companyId)) notes.set(o.companyId, o.note as string);
  return notes;
}

function queueRow(state: DemoState, company: Company, timing: string, overdue: number | null, notes: Map<string, string>): QueueRow {
  const claim = claimView(state, company);
  return {
    company,
    claim,
    timing,
    daysOverdue: overdue,
    contact: state.contacts.filter((c) => c.companyId === company.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null,
    lastNote: notes.get(company.id) ?? null,
    action: claim.state === "mine" ? "log-outreach" : claim.state === "theirs" ? "none" : "claim",
  };
}

// The follow-up queue: every open company whose follow-up date has arrived, most overdue first, then
// a collapsed list of fresh leads nobody else holds. Same rules and limits as lib/queue.ts.
export function selectQueue(state: DemoState, ws: string, filters: QueueFilters = DEFAULT_QUEUE_FILTERS): Queue {
  const open = inWorkspace(state, ws).filter(isOpen);
  const stateOf = (c: Company) => claimStateOf(c, state.now, state.meId);
  const mine = (c: Company) => !filters.mine || stateOf(c) === "mine";
  const notes = latestNotes(state, ws);

  const dueAll = open
    .filter((c) => mine(c) && c.nextFollowUpAt !== null && time(c.nextFollowUpAt) <= Date.parse(state.now))
    .sort((a, b) => time(a.nextFollowUpAt) - time(b.nextFollowUpAt) || byName(a, b));
  const dueLimit = filters.all === "due" ? SHOW_ALL_LIMIT : QUEUE_SIZE;

  // Fresh leads: never contacted, no follow-up yet, and not held by someone else.
  const neverAll = open
    .filter((c) => c.stage === "NOT_CONTACTED" && c.nextFollowUpAt === null && (filters.mine ? stateOf(c) === "mine" : stateOf(c) !== "theirs"))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const neverLimit = filters.all === "never" ? SHOW_ALL_LIMIT : QUEUE_SIZE;

  const due = dueAll.slice(0, dueLimit).map((c) => queueRow(state, c, overdueLabel(c.nextFollowUpAt as string, state.now), daysOverdue(c.nextFollowUpAt as string, state.now), notes));
  const never = filters.never && neverAll.length > 0 ? neverAll.slice(0, neverLimit).map((c) => queueRow(state, c, "No outreach yet", null, notes)) : null;
  return {
    now: state.now,
    filters,
    due,
    dueCount: dueAll.length,
    never,
    neverCount: neverAll.length,
    hasMoreDue: due.length < dueAll.length,
    hasMoreNever: never !== null && never.length < neverAll.length,
  };
}

// ----- The board -----

export type BoardCard = {
  company: Company;
  claim: ClaimView;
  // "Oct 30", or null when no follow-up is set.
  followUp: string | null;
  overdue: boolean;
  // Whole calendar days past the follow-up date (negative before it), null when none is set.
  daysOverdue: number | null;
  // Committed and Declined cards cannot be claimed.
  closed: boolean;
};

export type BoardColumn = { stage: Stage; label: string; count: number; open: boolean; cards: BoardCard[]; hasMore: boolean };

export type DuplicatePair = { a: DuplicateSide; b: DuplicateSide; matchedOn: MatchReason[] };
export type DuplicateSide = { id: string; name: string; website: string | null };

export type Board = {
  filters: BoardFilters;
  columns: BoardColumn[];
  // Active companies matching the filters, across all columns.
  total: number;
  industries: string[];
  archivedCount: number;
  archived: Company[] | null;
  duplicatePairs: DuplicatePair[];
  // 50 means "50 or more": the box is capped.
  duplicatePairsCapped: boolean;
};

export function selectIndustries(state: DemoState, ws: string): string[] {
  return [...new Set(inWorkspace(state, ws).flatMap((c) => (c.industry ? [c.industry] : [])))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

// Look-alike pairs already in the workspace, minus pairs a person marked separate. Capped, like
// listPossibleDuplicatePairs in lib/companies.ts.
export function selectDuplicatePairs(state: DemoState, ws: string, limit: number = DUPLICATE_PAIR_LIMIT): DuplicatePair[] {
  const companies = inWorkspace(state, ws)
    .filter((c) => c.archivedAt === null)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const separate = new Set(state.pairDecisions.filter((d) => d.workspaceId === ws).map((d) => `${d.companyAId}|${d.companyBId}`));
  const groups = new Map<string, Company[]>();
  for (const c of companies) {
    for (const key of [`name:${c.nameKey}`, ...(c.domainKey ? [`site:${c.domainKey}`] : [])]) groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const pairs = new Map<string, DuplicatePair>();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [aId, bId] = orderedPair(group[i].id, group[j].id);
        const id = `${aId}|${bId}`;
        if (separate.has(id) || pairs.has(id)) continue;
        const [a, b] = aId === group[i].id ? [group[i], group[j]] : [group[j], group[i]];
        const side = (c: Company): DuplicateSide => ({ id: c.id, name: c.name, website: c.website });
        pairs.set(id, { a: side(a), b: side(b), matchedOn: matchReasons(a, b) });
        if (pairs.size >= limit) return [...pairs.values()];
      }
    }
  }
  return [...pairs.values()];
}

// Literal, case-insensitive "contains", like the board's search box.
const containsText = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

export function selectBoard(state: DemoState, ws: string, filters: BoardFilters = DEFAULT_BOARD_FILTERS): Board {
  const matching = inWorkspace(state, ws).filter((c) => (!filters.q || containsText(c.name, filters.q)) && (!filters.industry || c.industry === filters.industry));
  const active = matching.filter((c) => c.archivedAt === null);

  const columns = STAGES.map((stage): BoardColumn => {
    const inStage = active.filter((c) => c.stage === stage);
    const open = !isTerminalStage(stage) || filters.show.includes(stage);
    if (!open || inStage.length === 0) return { stage, label: STAGE_LABELS[stage], count: inStage.length, open, cards: [], hasMore: false };
    const limit = filters.all === stage ? SHOW_ALL_LIMIT : COLUMN_SIZE;
    // Soonest follow-up first, companies without one last, then by name.
    const sorted = [...inStage].sort((a, b) => time(a.nextFollowUpAt) - time(b.nextFollowUpAt) || byName(a, b));
    const cards = sorted.slice(0, limit).map(
      (company): BoardCard => ({
        company,
        claim: claimView(state, company),
        followUp: company.nextFollowUpAt ? formatDay(company.nextFollowUpAt) : null,
        overdue: company.nextFollowUpAt !== null && Date.parse(company.nextFollowUpAt) < Date.parse(state.now),
        daysOverdue: company.nextFollowUpAt ? daysOverdue(company.nextFollowUpAt, state.now) : null,
        closed: isTerminalStage(company.stage),
      }),
    );
    return { stage, label: STAGE_LABELS[stage], count: inStage.length, open, cards, hasMore: sorted.length > limit };
  });

  const archivedAll = matching.filter((c) => c.archivedAt !== null).sort((a, b) => Date.parse(b.archivedAt as string) - Date.parse(a.archivedAt as string));
  const pairs = selectDuplicatePairs(state, ws);
  return {
    filters,
    columns,
    total: columns.reduce((sum, c) => sum + c.count, 0),
    industries: selectIndustries(state, ws),
    archivedCount: archivedAll.length,
    archived: filters.archived && archivedAll.length > 0 ? archivedAll.slice(0, SHOW_ALL_LIMIT) : null,
    duplicatePairs: pairs,
    duplicatePairsCapped: pairs.length >= DUPLICATE_PAIR_LIMIT,
  };
}

// ----- The Companies list -----

export type CompanyListRow = {
  company: Company;
  claim: ClaimView;
  // Whole calendar days past the follow-up date (negative before it), null when none is set.
  daysOverdue: number | null;
  // "Nov 2", or null when no follow-up is set.
  followUpOn: string | null;
  // The date the margin column and the sort use: the last outreach, or the day it was added.
  datedAt: IsoDateTime;
  // "Oct 20", or null when it was never contacted.
  lastOutreachOn: string | null;
  closed: boolean;
};

export type CompanyList = {
  filters: CompaniesFilters;
  rows: CompanyListRow[];
  // Every active company in the workspace, and how many match the search (before the stage filter).
  workspaceTotal: number;
  matchTotal: number;
  stageCounts: Record<Stage, number>;
};

// Every active company in the workspace, searched, filtered by stage and sorted.
export function selectCompanyList(state: DemoState, ws: string, filters: CompaniesFilters = DEFAULT_COMPANIES_FILTERS): CompanyList {
  const active = inWorkspace(state, ws).filter((c) => c.archivedAt === null);
  const contacts = state.contacts.filter((c) => c.workspaceId === ws);
  const q = filters.q.trim().toLowerCase();
  const searched = q
    ? active.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.industry?.toLowerCase().includes(q) ||
          c.website?.toLowerCase().includes(q) ||
          contacts.some((k) => k.companyId === c.id && (k.name.toLowerCase().includes(q) || k.email?.toLowerCase().includes(q))),
      )
    : active;
  const stageCounts = Object.fromEntries(STAGES.map((s) => [s, searched.filter((c) => c.stage === s).length])) as Record<Stage, number>;
  const shown = filters.stage ? searched.filter((c) => c.stage === filters.stage) : searched;
  const datedAt = (c: Company) => c.lastContactedAt ?? c.createdAt;
  const sorters: Record<CompaniesFilters["sort"], (a: Company, b: Company) => number> = {
    recent: (a, b) => Date.parse(datedAt(b)) - Date.parse(datedAt(a)) || byName(a, b),
    followup: (a, b) => time(a.nextFollowUpAt) - time(b.nextFollowUpAt) || byName(a, b),
    name: byName,
    stage: (a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || byName(a, b),
  };
  const rows = [...shown].sort(sorters[filters.sort]).map(
    (company): CompanyListRow => ({
      company,
      claim: claimView(state, company),
      daysOverdue: company.nextFollowUpAt ? daysOverdue(company.nextFollowUpAt, state.now) : null,
      followUpOn: company.nextFollowUpAt ? formatDay(company.nextFollowUpAt) : null,
      datedAt: datedAt(company),
      lastOutreachOn: company.lastContactedAt ? formatDay(company.lastContactedAt) : null,
      closed: isTerminalStage(company.stage),
    }),
  );
  return { filters, rows, workspaceTotal: active.length, matchTotal: searched.length, stageCounts };
}

// ----- Search -----

export type SearchHit = { company: Company; matchedOn: "name" | "industry" | "website" | "contact" | "notes"; claim: ClaimView };

// Finds companies by name first (starts-with ranks above contains), then industry, website, contact
// name or email, and notes. Archived companies are left out unless asked for.
export function selectSearch(state: DemoState, ws: string, query: string, options: { includeArchived?: boolean; limit?: number } = {}): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const contacts = state.contacts.filter((c) => c.workspaceId === ws);
  const hits: { hit: SearchHit; rank: number }[] = [];
  for (const company of inWorkspace(state, ws)) {
    if (company.archivedAt && !options.includeArchived) continue;
    const name = company.name.toLowerCase();
    let matchedOn: SearchHit["matchedOn"] | null = null;
    let rank = 0;
    if (name.startsWith(q)) [matchedOn, rank] = ["name", 0];
    else if (name.includes(q)) [matchedOn, rank] = ["name", 1];
    else if (company.industry?.toLowerCase().includes(q)) [matchedOn, rank] = ["industry", 2];
    else if (company.website?.toLowerCase().includes(q)) [matchedOn, rank] = ["website", 3];
    else if (contacts.some((c) => c.companyId === company.id && (c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)))) [matchedOn, rank] = ["contact", 4];
    else if (company.notes?.toLowerCase().includes(q)) [matchedOn, rank] = ["notes", 5];
    if (matchedOn) hits.push({ hit: { company, matchedOn, claim: claimView(state, company) }, rank });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || byName(a.hit.company, b.hit.company))
    .slice(0, options.limit ?? 20)
    .map((h) => h.hit);
}

// ----- A company -----

export type OutreachView = Outreach & { senderName: string; channelLabel: string; templateName: string | null; fromAiDraft: boolean };
export type StageChangeView = StageChange & { changedByName: string; fromLabel: string; toLabel: string };

export type CompanyDetail = {
  company: Company;
  archived: boolean;
  stageLabel: string;
  // Committed and Declined: closed, cannot be claimed.
  closed: boolean;
  claim: ClaimView;
  contacts: Contact[];
  // Newest first, the latest 100.
  outreach: OutreachView[];
  // Newest first, the latest 50.
  stageChanges: StageChangeView[];
  industries: string[];
  role: Role | null;
  // The buttons that fit: Claim (free or expired), Release (mine), Force release (owner, theirs).
  canClaim: boolean;
  canRelease: boolean;
  canForceRelease: boolean;
  // The log outreach form shows only for the holder.
  canLogOutreach: boolean;
  // The Draft an email section shows when the company is open and nobody else holds it.
  canDraft: boolean;
  ai: AiAvailability;
  // The people who can be picked as the recipient of a draft.
  draftContacts: Contact[];
  // My latest Draft click for this company, so drafts survive a reload.
  drafts: Draft[];
  // What the Claim Checker's rules accept: numbers from verified facts, and the company's website.
  ruleContext: RuleContext;
  verifiedFactCount: number;
  // Follow-up date box: today, a week out (the default), and a year out (the most).
  today: string;
  defaultFollowUpOn: string;
  maxFollowUpOn: string;
  templates: Template[];
  lastContacted: string | null;
  nextFollowUp: string | null;
  // "Due today", "3 days overdue", "Due in 5 days", or null.
  followUpLabel: string | null;
  // Whole calendar days past the follow-up date (negative before it), null when none is set.
  followUpDays: number | null;
  // The first line under the name: "Contacted · Aerospace · acme.com".
  headline: string;
};

export type AiAvailability = {
  // The workspace switch is on and the server has a key.
  available: boolean;
  serverConfigured: boolean;
  workspaceEnabled: boolean;
  // "AI drafting is off for this workspace. An owner can turn it on in Settings." and its relatives.
  unavailableMessage: string | null;
};

export function selectAi(state: DemoState, ws: string): AiAvailability {
  const workspace = workspaceById(state, ws);
  const serverConfigured = state.serverAiConfigured;
  const workspaceEnabled = workspace?.aiEnabled ?? false;
  const available = serverConfigured && workspaceEnabled;
  return {
    available,
    serverConfigured,
    workspaceEnabled,
    unavailableMessage: available ? null : "AI drafting is off for this workspace. An owner can turn it on in Settings.",
  };
}

const verifiedFacts = (state: DemoState, ws: string): Fact[] =>
  state.facts.filter((f) => f.workspaceId === ws && f.verifiedAt !== null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));

export const selectVerifiedFacts = verifiedFacts;

// The latest Draft click of the signed-in person for a company. One click's drafts share a createdAt.
export function selectDrafts(state: DemoState, ws: string, companyId: string): Draft[] {
  const mine = state.drafts.filter((d) => d.workspaceId === ws && d.companyId === companyId && d.createdById === state.meId);
  if (mine.length === 0) return [];
  const latest = Math.max(...mine.map((d) => Date.parse(d.createdAt)));
  return mine.filter((d) => Date.parse(d.createdAt) === latest).sort((a, b) => a.id.localeCompare(b.id));
}

export function selectCompany(state: DemoState, ws: string, companyId: string): CompanyDetail | null {
  const member = myMembership(state, ws);
  const company = state.companies.find((c) => c.id === companyId && c.workspaceId === ws);
  // Not found and "in another workspace" look the same, like the real page.
  if (!member || !company) return null;
  const claim = claimView(state, company);
  const closed = isTerminalStage(company.stage);
  const archived = company.archivedAt !== null;
  const ai = selectAi(state, ws);
  const templates = state.templates.filter((t) => t.workspaceId === ws);
  const contacts = state.contacts.filter((c) => c.companyId === company.id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const facts = verifiedFacts(state, ws);
  const today = localYmd(state.now);

  const outreach = state.outreach
    .filter((o) => o.companyId === company.id)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.id.localeCompare(b.id))
    .slice(0, 100)
    .map((o): OutreachView => ({
      ...o,
      senderName: personName(state, o.senderId),
      channelLabel: CHANNEL_LABELS[o.channel],
      templateName: templates.find((t) => t.id === o.templateId)?.name ?? null,
      fromAiDraft: o.aiDraftId !== null,
    }));
  const stageChanges = state.stageChanges
    .filter((s) => s.companyId === company.id)
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || a.id.localeCompare(b.id))
    .slice(0, 50)
    .map((s): StageChangeView => ({ ...s, changedByName: personName(state, s.changedById), fromLabel: STAGE_LABELS[s.fromStage], toLabel: STAGE_LABELS[s.toStage] }));

  const headline = [STAGE_LABELS[company.stage], company.industry, company.website].filter(Boolean).join(" · ");
  return {
    company,
    archived,
    stageLabel: STAGE_LABELS[company.stage],
    closed,
    claim,
    contacts,
    outreach,
    stageChanges,
    industries: selectIndustries(state, ws),
    role: member.role,
    canClaim: !archived && !closed && (claim.state === "free" || claim.state === "expired"),
    canRelease: !archived && claim.state === "mine",
    canForceRelease: !archived && !closed && member.role === "owner" && claim.state === "theirs",
    canLogOutreach: !archived && !closed && claim.state === "mine",
    canDraft: !archived && !closed && claim.state !== "theirs",
    ai,
    draftContacts: contacts,
    drafts: selectDrafts(state, ws, company.id),
    ruleContext: { factNumbers: factNumbers(facts), website: company.website },
    verifiedFactCount: facts.length,
    today,
    defaultFollowUpOn: addDaysYmd(today, DEFAULT_FOLLOW_UP_DAYS),
    maxFollowUpOn: addDaysYmd(today, MAX_FOLLOW_UP_DAYS),
    templates: templates.filter((t) => t.archivedAt === null),
    lastContacted: company.lastContactedAt ? formatDay(company.lastContactedAt) : null,
    nextFollowUp: company.nextFollowUpAt ? formatDay(company.nextFollowUpAt) : null,
    followUpLabel: company.nextFollowUpAt ? dueLabel(company.nextFollowUpAt, state.now) : null,
    followUpDays: company.nextFollowUpAt ? daysOverdue(company.nextFollowUpAt, state.now) : null,
    headline,
  };
}

// ----- The reply question -----

export type ReplyChoice = {
  // True when moving to this stage means the company wrote back and no outreach is flagged yet, so
  // the screen should ask which one got the reply.
  needed: boolean;
  // The outreach to pick from, newest first.
  options: OutreachView[];
};

// Moving to Replied or later asks "which outreach got the reply?" once, so reply rates per template
// are right. Skipped when there is no outreach to pick from or one is already flagged.
export function selectReplyChoice(state: DemoState, ws: string, companyId: string, toStage: Stage): ReplyChoice {
  const detail = selectCompany(state, ws, companyId);
  if (!detail || !REPLY_STAGES.includes(toStage)) return { needed: false, options: [] };
  const flagged = detail.outreach.some((o) => o.gotReply);
  return { needed: !flagged && detail.outreach.length > 0 && detail.company.stage !== toStage, options: detail.outreach };
}

// ----- Template stats -----

export type TemplateStat = {
  template: Template;
  sent: number;
  replies: number;
  // 0 to 1, or null when nothing was sent.
  replyRate: number | null;
  companies: number;
  lastUsedAt: IsoDateTime | null;
};

export type TemplateStats = {
  templates: TemplateStat[];
  // Outreach that used no template, split by whether it came from an AI draft.
  handWritten: { sent: number; replies: number; replyRate: number | null };
  fromAiDrafts: { sent: number; replies: number; replyRate: number | null };
  totalSent: number;
  totalReplies: number;
};

const rate = (replies: number, sent: number) => (sent === 0 ? null : replies / sent);

export function selectTemplateStats(state: DemoState, ws: string): TemplateStats {
  const rows = state.outreach.filter((o) => o.workspaceId === ws);
  const stat = (list: Outreach[]) => ({ sent: list.length, replies: list.filter((o) => o.gotReply).length, replyRate: rate(list.filter((o) => o.gotReply).length, list.length) });
  const templates = state.templates
    .filter((t) => t.workspaceId === ws)
    .map((template): TemplateStat => {
      const used = rows.filter((o) => o.templateId === template.id);
      const replies = used.filter((o) => o.gotReply).length;
      return {
        template,
        sent: used.length,
        replies,
        replyRate: rate(replies, used.length),
        companies: new Set(used.map((o) => o.companyId)).size,
        lastUsedAt: used.length > 0 ? used.map((o) => o.sentAt).sort().at(-1) ?? null : null,
      };
    })
    .sort((a, b) => b.sent - a.sent || a.template.name.localeCompare(b.template.name));
  const plain = rows.filter((o) => o.templateId === null);
  return {
    templates,
    handWritten: stat(plain.filter((o) => o.aiDraftId === null)),
    fromAiDrafts: stat(plain.filter((o) => o.aiDraftId !== null)),
    totalSent: rows.length,
    totalReplies: rows.filter((o) => o.gotReply).length,
  };
}

// ----- The fact sheet -----

export type FactView = Fact & {
  verifiedByName: string | null;
  stale: boolean;
  // "Page 6 of BRC-Sponsorship-Packet-2026-27.pdf", "Page unknown of ...", or "Added by hand".
  sourceLabel: string;
  fileName: string | null;
  createdByName: string;
};

export type FactSheetView = {
  role: Role | null;
  isOwner: boolean;
  sheets: (FactSheetFile & { uploadedByName: string })[];
  // Facts waiting for an owner's check. Only owners see this section.
  unverified: FactView[];
  verified: FactView[];
  staleCount: number;
  // A PDF fact whose quote is not found on its page, or does not match the fact: an owner must look.
  mismatchCount: number;
  ai: AiAvailability;
  uploading: boolean;
};

export function selectFactSheet(state: DemoState, ws: string): FactSheetView {
  const role = myMembership(state, ws)?.role ?? null;
  const sheets = state.factSheets.filter((s) => s.workspaceId === ws).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const view = (f: Fact): FactView => {
    const sheet = sheets.find((s) => s.id === f.factSheetId);
    return {
      ...f,
      verifiedByName: f.verifiedById ? personName(state, f.verifiedById) : null,
      stale: f.verifiedAt !== null && isFactStale(f, state.now),
      fileName: sheet?.fileName ?? null,
      sourceLabel:
        f.source === "PDF" ? `${f.pageNumber ? `Page ${f.pageNumber}` : "Page unknown"} of ${sheet?.fileName ?? "a deleted file"}` : "Added by hand",
      createdByName: personName(state, f.createdById),
    };
  };
  // Unverified first, then by creation order, like the real page.
  const all = state.facts
    .filter((f) => f.workspaceId === ws)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
    .map(view);
  return {
    role,
    isOwner: role === "owner",
    sheets: sheets.map((s) => ({ ...s, uploadedByName: personName(state, s.uploadedById) })),
    unverified: all.filter((f) => f.verifiedAt === null),
    verified: all.filter((f) => f.verifiedAt !== null),
    staleCount: all.filter((f) => f.stale).length,
    mismatchCount: all.filter((f) => f.source === "PDF" && !f.quoteFound).length,
    ai: selectAi(state, ws),
    uploading: state.busy.uploading.includes(ws),
  };
}

// ----- Settings -----

export type MemberView = {
  member: Member;
  person: Person;
  role: Role;
  roleLabel: string;
  isMe: boolean;
  // Emails are shown to owners only; an officer never receives them.
  email: string | null;
  // Make Owner / Make Officer, and Remove, as the real screen offers them (owners only).
  canChangeRole: boolean;
  canRemove: boolean;
  nextRoleLabel: string;
  heldCompanies: number;
};

export type InvitationView = Invitation & { roleLabel: string; inviterName: string; expiresLabel: string };

export type SettingsView = {
  workspace: Workspace;
  role: Role | null;
  isOwner: boolean;
  members: MemberView[];
  ownerCount: number;
  // Only owners see pending invitations.
  invitations: InvitationView[];
  claimWindowDays: number;
  ai: AiAvailability & { enabled: boolean; limit: number; used: number; windowDays: number; remaining: number; atLimit: boolean };
  // The last owner cannot leave or step down.
  iAmLastOwner: boolean;
};

export function selectSettings(state: DemoState, ws: string): SettingsView | null {
  const workspace = workspaceById(state, ws);
  const mine = myMembership(state, ws);
  if (!workspace || !mine) return null;
  const isOwner = mine.role === "owner";
  const members = state.members.filter((m) => m.workspaceId === ws).sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const held = (userId: string) => state.companies.filter((c) => c.workspaceId === ws && c.claimedById === userId && claimStateOf(c, state.now, state.meId) !== "expired").length;
  const ai = selectAi(state, ws);
  return {
    workspace,
    role: mine.role,
    isOwner,
    members: members.map((member): MemberView => {
      const person = personById(state, member.userId) as Person;
      const isMe = member.userId === state.meId;
      return {
        member,
        person,
        role: member.role,
        roleLabel: ROLE_LABELS[member.role],
        isMe,
        email: isOwner ? person.email : null,
        canChangeRole: isOwner,
        canRemove: isOwner && !isMe,
        nextRoleLabel: member.role === "owner" ? "Make Officer" : "Make Owner",
        heldCompanies: held(member.userId),
      };
    }),
    ownerCount,
    invitations: isOwner
      ? state.invitations
          .filter((i) => i.workspaceId === ws && Date.parse(i.expiresAt) > Date.parse(state.now))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map((i): InvitationView => ({ ...i, roleLabel: ROLE_LABELS[i.role], inviterName: personName(state, i.inviterId), expiresLabel: `Expires ${formatWhen(i.expiresAt)}` }))
      : [],
    claimWindowDays: workspace.claimWindowDays,
    ai: {
      ...ai,
      enabled: workspace.aiEnabled,
      limit: workspace.aiMonthlyLimit,
      used: workspace.aiCallsUsed,
      windowDays: AI_WINDOW_DAYS,
      remaining: Math.max(0, workspace.aiMonthlyLimit - workspace.aiCallsUsed),
      atLimit: workspace.aiCallsUsed >= workspace.aiMonthlyLimit,
    },
    iAmLastOwner: isOwner && ownerCount <= 1,
  };
}

// ----- Workspace numbers and activity -----

export type WorkspaceStats = {
  total: number;
  byStage: Record<Stage, number>;
  due: number;
  // Due with a follow-up date before today (at least one day late).
  overdue: number;
  neverContacted: number;
  mine: number;
  heldByOthers: number;
  // Live claims that run out within two days.
  expiringSoon: number;
  expiredClaims: number;
  archived: number;
  outreachThisMonth: number;
  replyRate: number | null;
};

export function selectWorkspaceStats(state: DemoState, ws: string): WorkspaceStats {
  const all = inWorkspace(state, ws);
  const active = all.filter((c) => c.archivedAt === null);
  const open = active.filter((c) => !isTerminalStage(c.stage));
  const byStage = Object.fromEntries(STAGES.map((s) => [s, active.filter((c) => c.stage === s).length])) as Record<Stage, number>;
  const now = Date.parse(state.now);
  const claimOf = (c: Company) => claimStateOf(c, state.now, state.meId);
  const outreach = state.outreach.filter((o) => o.workspaceId === ws);
  const month = outreach.filter((o) => now - Date.parse(o.sentAt) <= 30 * 86_400_000);
  const due = open.filter((c) => c.nextFollowUpAt !== null && Date.parse(c.nextFollowUpAt) <= now);
  return {
    total: active.length,
    byStage,
    due: due.length,
    overdue: due.filter((c) => daysOverdue(c.nextFollowUpAt as string, state.now) >= 1).length,
    neverContacted: open.filter((c) => c.stage === "NOT_CONTACTED" && c.nextFollowUpAt === null).length,
    mine: active.filter((c) => claimOf(c) === "mine").length,
    heldByOthers: active.filter((c) => claimOf(c) === "theirs").length,
    expiringSoon: active.filter((c) => {
      const cs = claimOf(c);
      return (cs === "mine" || cs === "theirs") && Date.parse(c.claimExpiresAt as string) - now <= 2 * 86_400_000;
    }).length,
    expiredClaims: active.filter((c) => claimOf(c) === "expired").length,
    archived: all.length - active.length,
    outreachThisMonth: month.length,
    replyRate: rate(outreach.filter((o) => o.gotReply).length, outreach.length),
  };
}

export type ActivityItem =
  | { kind: "outreach"; at: IsoDateTime; company: Company; byName: string; text: string }
  | { kind: "stage"; at: IsoDateTime; company: Company; byName: string; text: string };

// The latest outreach and stage moves across the workspace, newest first.
export function selectActivity(state: DemoState, ws: string, limit = 20): ActivityItem[] {
  const company = (id: string) => state.companies.find((c) => c.id === id);
  const items: ActivityItem[] = [];
  for (const o of state.outreach) {
    const c = o.workspaceId === ws ? company(o.companyId) : undefined;
    if (c) items.push({ kind: "outreach", at: o.sentAt, company: c, byName: personName(state, o.senderId), text: `${CHANNEL_LABELS[o.channel]} outreach${o.note ? `: ${o.note}` : ""}` });
  }
  for (const s of state.stageChanges) {
    const c = s.workspaceId === ws ? company(s.companyId) : undefined;
    if (c) items.push({ kind: "stage", at: s.changedAt, company: c, byName: personName(state, s.changedById), text: `Moved from ${STAGE_LABELS[s.fromStage]} to ${STAGE_LABELS[s.toStage]}` });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
