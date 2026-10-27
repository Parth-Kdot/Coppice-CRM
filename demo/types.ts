// Types for the design prototypes. They mirror the real models in prisma/schema.prisma, limited to
// what the screens show. Dates are ISO strings (always UTC, like "2026-10-28T19:00:00.000Z") so the
// same value renders on the server and in the browser; calendar days are "YYYY-MM-DD" strings in
// West Lafayette time, like the follow-up date box in the real app.
//
// This file holds shapes and labels only. No visuals live anywhere in demo/.

export type IsoDateTime = string;
export type YmdDate = string;

// ----- Enums, as string unions with the labels the real app shows -----

export const STAGES = ["NOT_CONTACTED", "CONTACTED", "REPLIED", "IN_CONVERSATION", "COMMITTED", "DECLINED"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  NOT_CONTACTED: "Not contacted",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  IN_CONVERSATION: "In conversation",
  COMMITTED: "Committed",
  DECLINED: "Declined",
};

// The outcomes. Moving here closes the pitch and clears any claim, so the UI asks first.
export const TERMINAL_STAGES: readonly Stage[] = ["COMMITTED", "DECLINED"];
export const isTerminalStage = (stage: Stage): boolean => TERMINAL_STAGES.includes(stage);

// Moving into one of these means a company wrote back, so the prototype asks which outreach got the reply.
export const REPLY_STAGES: readonly Stage[] = ["REPLIED", "IN_CONVERSATION", "COMMITTED", "DECLINED"];

// Better Auth's role names. The screens show "member" as Officer.
export const ROLES = ["owner", "member"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", member: "Officer" };

export const CHANNELS = ["EMAIL", "LINKEDIN", "IN_PERSON", "OTHER"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  LINKEDIN: "LinkedIn",
  IN_PERSON: "In person",
  OTHER: "Other",
};

export type DraftKind = "FIRST_TOUCH" | "FOLLOW_UP";
export const DRAFT_KIND_LABELS: Record<DraftKind, string> = { FIRST_TOUCH: "First email", FOLLOW_UP: "Follow-up" };

export type FactSource = "PDF" | "MANUAL";

// What the Claim Checker flags: a number nobody verified, a link nobody checked, a claimed history
// with the company, or any other sentence the verified facts do not support.
export type FindingKind = "number" | "link" | "history" | "unsupported";
export const FINDING_LABELS: Record<FindingKind, string> = {
  number: "Number",
  link: "Link",
  history: "History",
  unsupported: "Not in the facts",
};

export type MatchReason = "name" | "website";

// free: nobody holds it. mine: you hold a live claim. theirs: someone else holds a live claim.
// expired: a claim exists but ran out (anyone may take the company).
export type ClaimState = "free" | "mine" | "theirs" | "expired";

export type WorkspaceKind = "student-org" | "hackathon" | "nonprofit";

// The shape every action returns, like ActionResult in lib/validation.ts: expected failures come
// back as { ok: false, error } with a message the screen can show as is.
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// ----- Models -----

// Everyone who ever appears in a name lookup, including people who left. History outlives people.
export type Person = { id: string; name: string; email: string };

export type Workspace = {
  id: string;
  name: string;
  kind: WorkspaceKind;
  school: string;
  // One line for the workspace list and the landing page.
  tagline: string;
  claimWindowDays: number;
  aiEnabled: boolean;
  // AI calls allowed per 30 days, and how many the workspace has used in that window.
  aiMonthlyLimit: number;
  aiCallsUsed: number;
  createdAt: IsoDateTime;
};

// A membership: one person in one workspace.
export type Member = {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  joinedAt: IsoDateTime;
};

// A pending invitation an owner created. There is no email: the invitee signs in and joins, or
// opens the copyable link.
export type Invitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
  inviterId: string;
  link: string;
};

// An invitation addressed to the signed-in person, shown on the workspace list with a Join button.
export type InvitationForMe = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  invitedByName: string;
};

export type Company = {
  id: string;
  workspaceId: string;
  name: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
  // Duplicate-matching keys, recomputed on every name or website change (lib/duplicates.ts).
  nameKey: string;
  domainKey: string | null;
  stage: Stage;
  nextFollowUpAt: IsoDateTime | null;
  lastContactedAt: IsoDateTime | null;
  // Claims: whoever holds the company until claimExpiresAt. A claim past its expiry is "expired".
  claimedById: string | null;
  claimExpiresAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Contact = {
  id: string;
  workspaceId: string;
  companyId: string;
  name: string;
  email: string | null;
  title: string | null;
  createdAt: IsoDateTime;
};

export type Outreach = {
  id: string;
  workspaceId: string;
  companyId: string;
  senderId: string;
  templateId: string | null;
  channel: Channel;
  sentAt: IsoDateTime;
  note: string | null;
  // True when this outreach is the one the company replied to. Feeds reply rates per template.
  gotReply: boolean;
  // The AI draft this outreach came from, if any.
  aiDraftId: string | null;
};

// Every stage move, kept forever.
export type StageChange = {
  id: string;
  workspaceId: string;
  companyId: string;
  changedById: string;
  fromStage: Stage;
  toStage: Stage;
  changedAt: IsoDateTime;
};

// "These two look alike but are separate companies." Remembered so the pair stops being flagged.
export type PairDecision = {
  id: string;
  workspaceId: string;
  companyAId: string;
  companyBId: string;
  decidedById: string;
  decidedAt: IsoDateTime;
};

export type Template = {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  // Used templates are archived, never deleted, so stats keep their history.
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
};

// An uploaded sponsorship packet.
export type FactSheetFile = {
  id: string;
  workspaceId: string;
  fileName: string;
  pageCount: number;
  uploadedById: string;
  createdAt: IsoDateTime;
};

// One fact the AI may state about the org. Nothing is used until an owner verifies it.
export type Fact = {
  id: string;
  workspaceId: string;
  // Null for facts typed in by hand.
  factSheetId: string | null;
  source: FactSource;
  text: string;
  // From a PDF: the sentence it came from, its page, and whether code found that sentence on that page.
  quote: string | null;
  pageNumber: number | null;
  quoteFound: boolean;
  verifiedAt: IsoDateTime | null;
  verifiedById: string | null;
  createdById: string;
  createdAt: IsoDateTime;
};

export type Finding = { kind: FindingKind; quote: string; reason: string };

// The Claim Checker's AI findings, saved with the exact text they were for. The rule findings
// (numbers, links, history) are recomputed on every keystroke by checkRules in demo/claims.ts.
export type DraftCheck = { subject: string; body: string; ai: Finding[]; error: string | null };

export type Draft = {
  id: string;
  workspaceId: string;
  companyId: string;
  contactId: string | null;
  createdById: string;
  kind: DraftKind;
  // A few words on what this variant leads with, for the officer.
  angle: string;
  subject: string;
  body: string;
  // The contact's email, for the To line of the compose links. Empty when there is none.
  to: string;
  // One click makes two drafts that share a createdAt.
  createdAt: IsoDateTime;
  check: DraftCheck | null;
  model: string;
};

// ----- The whole prototype state -----

export type DemoState = {
  // The clock. Fixed at DEMO_NOW until a demo tool moves it.
  now: IsoDateTime;
  // Counter for ids, so they are deterministic.
  seq: number;
  // Whether the sign-in screen has been passed. Nothing enforces it; screens may use it.
  signedIn: boolean;
  // The signed-in person.
  meId: string;
  canCreateWorkspace: boolean;
  // False shows the "AI isn't set up on this server yet" notice, like a missing GEMINI_API_KEY.
  serverAiConfigured: boolean;
  people: Person[];
  workspaces: Workspace[];
  members: Member[];
  invitations: Invitation[];
  invitationsForMe: InvitationForMe[];
  companies: Company[];
  contacts: Contact[];
  outreach: Outreach[];
  stageChanges: StageChange[];
  pairDecisions: PairDecision[];
  templates: Template[];
  factSheets: FactSheetFile[];
  facts: Fact[];
  drafts: Draft[];
  // Work in flight, so every screen can show "Drafting..." for the same company.
  busy: { drafting: string[]; checking: string[]; uploading: string[] };
};
