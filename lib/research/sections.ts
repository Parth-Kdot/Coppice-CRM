import type { BriefView } from "@/lib/research/brief";

// The parts of a research brief besides its doors: campus ties, red flags, one outreach hook and
// one suggested ask (lib/research/brief.ts). Shared by the server (the AI's schemas, the checks)
// and the company page (labels, headings), so it has no server imports.

// What a passage from the reading call is about. An old recorded reply has no topic, which means
// DOOR (lib/research/brief-prompt.ts).
export const TOPICS = ["DOOR", "CAMPUS_TIE", "RED_FLAG", "HOOK"] as const;
export type Topic = (typeof TOPICS)[number];

// The kinds of red flag. Code never judges whether a stated deadline has passed: the flag quotes
// it and the officer reads it.
export const FLAG_KINDS = ["NO_STUDENT_GROUPS", "ELIGIBILITY", "TIMING", "PAUSED", "OTHER"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const FLAG_LABELS: Record<FlagKind, string> = {
  NO_STUDENT_GROUPS: "Doesn't fund student groups",
  ELIGIBILITY: "Eligibility rules",
  TIMING: "Deadline or window",
  PAUSED: "Program paused",
  OTHER: "Other",
};

export const SECTION_HEADINGS = {
  ties: "Campus ties",
  flags: "Red flags",
  hook: "Outreach hook",
  ask: "Suggested ask",
} as const;

// What each section stores in CompanyBrief.brief. Every one carries the page it quotes; the ask
// stores the verified fact's id and its text as the database had it, never the model's words.
export type BriefTie = { id: string; title: string; detail: string; page: number; quote: string };
export type BriefFlag = { id: string; kind: FlagKind; title: string; page: number; quote: string };
export type BriefHook = { id: string; line: string; page: number; quote: string };
export type BriefAsk = { id: string; factId: string; factText: string; reason: string; page: number; quote: string };

// The ids: t1.. for ties, r1.. for red flags, h1 and a1. Doors are i1.. and team inboxes m1-1..,
// so none collide.
export const HOOK_ID = "h1";
export const ASK_ID = "a1";

// Shown on, and returned for, an ask whose verified fact was edited or unverified since.
export const ASK_CHANGED = "The tier this ask named changed or is no longer verified. Ask for a new brief.";

// Whether a brief found anything worth showing: a door, a tie, a flag, the hook or the ask. A team
// inbox alone doesn't count (lib/research/brief.ts, loadBrief).
export function viewHasFindings(view: Pick<BriefView, "items" | "ties" | "flags" | "hook" | "ask">): boolean {
  return view.items.length > 0 || view.ties.length > 0 || view.flags.length > 0 || view.hook !== null || view.ask !== null;
}

// Whether an item of any section, or a team inbox, is already in the company's notes. The app and
// the MCP tool both use this, so they can't disagree.
export function isAccepted(brief: Pick<BriefView, "items" | "inboxes" | "ties" | "flags" | "hook" | "ask">, itemId: string): boolean {
  const all: { id: string; accepted: boolean }[] = [...brief.items, ...brief.inboxes, ...brief.ties, ...brief.flags];
  if (brief.hook) all.push(brief.hook);
  if (brief.ask) all.push(brief.ask);
  return all.some((i) => i.id === itemId && i.accepted);
}
