import { claimCompany } from "./engine-claims";
import { asMember, companyOf, done, nextId, refuse, type Step } from "./engine-core";
import { formatDay } from "./dates";
import { fill, PLACEHOLDERS } from "./rules";
import type { ActionResult, Company, Contact, DemoState, Draft, DraftCheck, DraftKind, Finding } from "./types";
import { AI_WINDOW_DAYS, DAILY_DRAFTS_PER_PERSON, DRAFT_NOTE_MAX, checkNote } from "./validation";

// The AI features, simulated. There is no model: the drafts are canned, built from the workspace's
// verified facts only, and the Claim Checker is a handful of phrase rules. What is faithful is the
// flow around it: the gates that can refuse, claiming the company first, the wait, the unsupported
// claims flagged, and the way an edited draft needs "Check again".

// What people see when a call fails. Never the model's raw error (lib/ai/run.ts).
export const AI_ERROR_MESSAGES = {
  not_configured: "AI isn't set up on this server yet.",
  bad_key: "The AI service rejected this server's key. Tell the app admin.",
  rate_limited: "The AI is busy right now. Try again in a minute.",
  timeout: "The AI took too long to answer. Try again.",
  blocked: "The AI declined to answer that. Try rewording your note.",
  truncated: "The AI's answer was cut off. Try again.",
  invalid_output: "The AI sent back something unusable. Try again.",
  rejected: "The AI service refused this request. Tell the app admin.",
  unavailable: "The AI service isn't responding. Try again in a few minutes.",
} as const;

export const MODEL_NAME = "gemini-3.8-flash";

type Feature = "DRAFT" | "CLAIM_CHECK" | "FACT_EXTRACTION";

// Whether this person may make an AI call right now: the server has a key, the workspace switch is
// on, the workspace has calls left in its 30 days, and (for drafts) this person is under their daily
// limit. Same checks, order and words as aiGate in lib/ai/run.ts.
export function aiGate(state: DemoState, ws: string, feature: Feature): ActionResult {
  if (!state.serverAiConfigured) return { ok: false, error: AI_ERROR_MESSAGES.not_configured };
  const workspace = state.workspaces.find((w) => w.id === ws);
  if (!workspace) return { ok: false, error: "Workspace not found." };
  if (!workspace.aiEnabled) return { ok: false, error: "AI is turned off for this workspace. An owner can turn it on in Settings." };
  if (workspace.aiCallsUsed >= workspace.aiMonthlyLimit) {
    return {
      ok: false,
      error: `This workspace has used its ${workspace.aiMonthlyLimit} AI calls for the last ${AI_WINDOW_DAYS} days. An owner can raise the limit in Settings.`,
    };
  }
  if (feature === "DRAFT") {
    const since = Date.parse(state.now) - 24 * 60 * 60 * 1000;
    // One click makes two drafts that share a createdAt, so count the clicks.
    const clicks = new Set(state.drafts.filter((d) => d.workspaceId === ws && d.createdById === state.meId && Date.parse(d.createdAt) >= since).map((d) => d.createdAt));
    if (clicks.size >= DAILY_DRAFTS_PER_PERSON) return { ok: false, error: `You've made ${DAILY_DRAFTS_PER_PERSON} drafts in the last 24 hours. Try again tomorrow.` };
  }
  return { ok: true, data: undefined };
}

const chargeCalls = (state: DemoState, ws: string, calls: number): DemoState => ({
  ...state,
  workspaces: state.workspaces.map((w) => (w.id === ws ? { ...w, aiCallsUsed: w.aiCallsUsed + calls } : w)),
});

// The "AI is busy" demo switch: when on, the next AI call fails once, then the switch turns itself off.
function consumeFailure(state: DemoState): { state: DemoState; failed: boolean } {
  return state.aiFailNext ? { state: { ...state, aiFailNext: false }, failed: true } : { state, failed: false };
}

// ----- The Claim Checker's AI pass -----

// Sentences that sound like a claim about the org or the sponsor, which the verified facts cannot
// back up. A real model judges this against the facts; the prototype uses phrases.
const SUSPECT =
  /\b(?:often tell us|best-prepared|among the best|one of the (?:most|best|top)|most active|award-winning|renowned|well-known|proven track|guarantee[sd]?|thousands of|millions of|love working|always|sponsors who joined|saw their logos)\b/i;

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 4);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// What the AI check would flag: suspect sentences that no verified fact says. Each quote is copied
// exactly from the text, like the real checker (which drops quotes that are not in the draft).
export function aiFindings(text: string, verified: { text: string }[]): Finding[] {
  const facts = verified.map((f) => normalize(f.text));
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const sentence of sentencesOf(text)) {
    const key = normalize(sentence);
    if (!SUSPECT.test(sentence) || seen.has(key) || facts.some((f) => f.includes(key) || key.includes(f))) continue;
    seen.add(key);
    findings.push({ kind: "unsupported", quote: sentence, reason: "No verified fact says this." });
  }
  return findings;
}

const verifiedFactsOf = (state: DemoState, ws: string) => state.facts.filter((f) => f.workspaceId === ws && f.verifiedAt !== null);

// ----- Draft an email -----

export type DraftRequest = { kind: DraftKind; contactId?: string | null; note?: string | null };

// What the first half of a draft hands to the second half, after the wait.
export type DraftTicket = { companyId: string; kind: DraftKind; contactId: string | null };

// The first half of "Draft two emails": the gates, the contact check, and claiming the company for
// you, all before the wait. As in the real app, the claim stays even if the AI then fails.
export function beginDraft(state: DemoState, ws: string, companyId: string, request: DraftRequest): Step<DraftTicket> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (request.kind !== "FIRST_TOUCH" && request.kind !== "FOLLOW_UP") return refuse(state, "Pick first email or follow-up.");
  const note = checkNote(request.note, DRAFT_NOTE_MAX);
  if (!note.ok) return refuse(state, note.error);

  const gate = aiGate(state, ws, "DRAFT");
  if (!gate.ok) return refuse(state, gate.error);
  const contactId = request.contactId || null;
  if (contactId && !state.contacts.some((c) => c.id === contactId && c.workspaceId === ws && c.companyId === companyId)) {
    return refuse(state, "Contact not found.");
  }

  const claim = claimCompany(state, ws, companyId);
  if (!claim.result.ok) return refuse(state, claim.result.error);
  const busy = { ...claim.state.busy, drafting: [...claim.state.busy.drafting, companyId] };
  return done({ ...claim.state, busy }, { companyId, kind: request.kind, contactId });
}

const withoutDrafting = (state: DemoState, companyId: string): DemoState => ({
  ...state,
  busy: { ...state.busy, drafting: state.busy.drafting.filter((id) => id !== companyId) },
});

type Variant = { angle: string; subject: string; body: string };

const SIGN_OFF = "Thanks,\n{{senderName}}\n{{orgName}}";

// Two canned variants built from the verified facts. The second one always leans on a flourish the
// facts do not support, so the checker has something to flag; a follow-up also quotes a figure no
// fact has, which the browser-side rules flag as a number.
function variantsFor(kind: DraftKind, facts: string[], company: Company, lastContactedAt: string | null): Variant[] {
  const [first, second, third] = facts;
  const lead = first ?? "";
  const more = second ?? "";
  const extra = third ?? second ?? first ?? "";
  if (kind === "FIRST_TOUCH") {
    return [
      {
        angle: facts.length > 0 ? "Lead with a verified fact" : "Short and plain",
        subject: "Partnering with {{orgName}}",
        body: `Hi {{firstName}},\n\nI'm {{senderName}}, an officer with {{orgName}}. ${lead} ${more}`.trimEnd() +
          `\n\nWould you be open to a short call, or would you like our sponsorship packet first?\n\n${SIGN_OFF}`,
      },
      {
        angle: facts.length > 0 ? "Lead with the benefits" : "Lead with the ask",
        subject: `${company.name} and {{orgName}}`,
        body: `Hi {{firstName}},\n\n{{senderName}} here from {{orgName}}. ${extra}`.trimEnd() +
          `\n\nCompanies like yours often tell us our members are among the best-prepared students they recruit.\n\nIf it would help, I can send the packet or set up a quick call.\n\n${SIGN_OFF}`,
      },
    ];
  }
  const when = lastContactedAt ? formatDay(lastContactedAt) : "recently";
  return [
    {
      angle: "A short nudge",
      subject: "Following up: {{orgName}}",
      body: `Hi {{firstName}},\n\nFollowing up on my note from ${when}. ${lead}`.trimEnd() + `\n\nHappy to send the packet again or answer any questions.\n\n${SIGN_OFF}`,
    },
    {
      angle: "Add one more reason",
      subject: `One more thing about {{orgName}}`,
      body: `Hi {{firstName}},\n\n{{senderName}} again from {{orgName}}. ${extra}`.trimEnd() +
        `\n\nSponsors who joined last season saw their logos in front of 1,200 students.\n\nWould a simpler next step help, like a ten-minute call?\n\n${SIGN_OFF}`,
    },
  ];
}

// The second half, after the wait: writes two drafts from the verified facts, fills in the names,
// runs the Claim Checker's AI pass on both, and charges two AI calls to the workspace. If the "AI is
// busy" switch is on, it fails instead and writes nothing.
export function finishDraft(state: DemoState, ws: string, ticket: DraftTicket): Step<Draft[]> {
  const base = withoutDrafting(state, ticket.companyId);
  const checked = asMember(base, ws);
  if (!checked.ok) return checked.step;
  const company = companyOf(base, ws, ticket.companyId);
  if (!company) return refuse(base, "Company not found.");

  const failure = consumeFailure(base);
  if (failure.failed) return refuse(failure.state, AI_ERROR_MESSAGES.rate_limited);

  const contact: Contact | undefined = ticket.contactId ? base.contacts.find((c) => c.id === ticket.contactId) : undefined;
  const facts = verifiedFactsOf(base, ws);
  const names = {
    firstName: contact?.name.trim().split(/\s+/)[0] || "there",
    senderName: base.people.find((p) => p.id === base.meId)?.name ?? "Officer",
    orgName: checked.workspace.name,
  };
  const variants = variantsFor(ticket.kind, facts.slice(0, 3).map((f) => f.text), company, company.lastContactedAt);

  let next = chargeCalls(base, ws, 2);
  const drafts: Draft[] = variants.map((variant) => {
    const withId = nextId(next, "d");
    next = withId.state;
    const subject = fill(variant.subject, names).trim();
    const body = fill(variant.body, names).trim();
    const check: DraftCheck = { subject, body, ai: aiFindings(`${subject}\n${body}`, facts), error: null };
    return {
      id: withId.id,
      workspaceId: ws,
      companyId: company.id,
      contactId: contact?.id ?? null,
      createdById: base.meId,
      kind: ticket.kind,
      angle: variant.angle,
      subject,
      body,
      to: contact?.email ?? "",
      // One click's drafts share a createdAt, so the latest click can be found together.
      createdAt: base.now,
      check,
      model: MODEL_NAME,
    };
  });
  return done({ ...next, drafts: [...next.drafts, ...drafts] }, drafts);
}

// Clears the in-flight mark when a draft is abandoned before it finishes.
export const abortDraft = withoutDrafting;

// ----- Check again -----

// The draft's AI findings for the text as it is now. Only the person who made a draft can check it.
// `checking` is marked in flight by the store while it waits.
export function beginCheck(state: DemoState, ws: string, draftId: string, text: { subject: string; body: string }): Step<{ draftId: string }> {
  const checked = asMember(state, ws);
  if (!checked.ok) return checked.step;
  if (text.body.trim() === "") return refuse(state, "Write the email first.");
  if (text.subject.length > 300) return refuse(state, "The subject is too long to check.");
  if (text.body.length > 6000) return refuse(state, "The email is too long to check.");
  if (!state.drafts.some((d) => d.id === draftId && d.workspaceId === ws && d.createdById === state.meId)) return refuse(state, "Draft not found.");
  const gate = aiGate(state, ws, "CLAIM_CHECK");
  if (!gate.ok) return refuse(state, gate.error);
  return done({ ...state, busy: { ...state.busy, checking: [...state.busy.checking, draftId] } }, { draftId });
}

export function finishCheck(state: DemoState, ws: string, draftId: string, text: { subject: string; body: string }): Step<DraftCheck> {
  const base: DemoState = { ...state, busy: { ...state.busy, checking: state.busy.checking.filter((id) => id !== draftId) } };
  const checked = asMember(base, ws);
  if (!checked.ok) return checked.step;
  const failure = consumeFailure(base);
  if (failure.failed) return refuse(failure.state, AI_ERROR_MESSAGES.rate_limited);
  // Line breaks are normalized, as the real action does, so the saved check matches the text on screen.
  const lf = (v: string) => v.replace(/\r\n?/g, "\n");
  const subject = lf(text.subject);
  const body = lf(text.body);
  const check: DraftCheck = { subject, body, ai: aiFindings(`${subject}\n${body}`, verifiedFactsOf(base, ws)), error: null };
  const next = chargeCalls(base, ws, 1);
  return done({ ...next, drafts: next.drafts.map((d) => (d.id === draftId ? { ...d, check } : d)) }, check);
}

export const abortCheck = (state: DemoState, draftId: string): DemoState => ({
  ...state,
  busy: { ...state.busy, checking: state.busy.checking.filter((id) => id !== draftId) },
});

// Placeholders the drafts may use, for screens that explain them.
export { PLACEHOLDERS };
