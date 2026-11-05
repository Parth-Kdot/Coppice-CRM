import type { Stage } from "@/generated/prisma/enums";

// The made-up data behind the small queue on the landing page. It is its own little world: no
// database, no real company. Today in the scene is Oct 28, so a 14-day claim made now runs to Nov 11.

export type MiniClaim = { kind: "free" } | { kind: "mine"; until: string } | { kind: "theirs"; who: string; until: string };

export type MiniRow = {
  id: string;
  name: string;
  stage: Stage;
  // Days past the follow-up date. Zero is due today, negative is still ahead.
  days: number;
  // The follow-up date as written when it is more than a week away.
  dueOn?: string;
  claim: MiniClaim;
  note: string;
};

export const MINI_NEVER = 12;
export const MINI_TOTAL = 42;

// Due soonest first, the way the queue sorts. Rows run from long overdue down to upcoming, and one
// company has not answered two emails.
export const MINI_ROWS: MiniRow[] = [
  { id: "midland", name: "Midland Tool and Die", stage: "CONTACTED", days: 14, claim: { kind: "free" }, note: "Two emails, no reply yet." },
  { id: "harlan", name: "Harlan Credit Union", stage: "IN_CONVERSATION", days: 9, claim: { kind: "theirs", who: "Priya R.", until: "Oct 31" }, note: "Asked for a call in November." },
  { id: "lakeshore", name: "Lakeshore Printing", stage: "CONTACTED", days: 6, claim: { kind: "free" }, note: "Left a voicemail at the front desk." },
  { id: "dunmore", name: "Dunmore Engineering", stage: "REPLIED", days: 3, claim: { kind: "mine", until: "Nov 11" }, note: "Dana wants the deck before Friday." },
  { id: "calloway", name: "Calloway Foods", stage: "CONTACTED", days: 1, claim: { kind: "theirs", who: "Marcus W.", until: "Nov 6" }, note: "Intro sent on LinkedIn." },
  { id: "westgate", name: "Westgate Dental", stage: "CONTACTED", days: 0, claim: { kind: "free" }, note: "Office manager is back Monday." },
  { id: "tricounty", name: "Tri-County Electric", stage: "IN_CONVERSATION", days: -3, claim: { kind: "free" }, note: "Sent last year's sponsor list." },
  { id: "summit", name: "Summit Freight", stage: "CONTACTED", days: -9, dueOn: "Nov 6", claim: { kind: "free" }, note: "Waiting on their budget cycle." },
  { id: "brennan", name: "Brennan Insurance Group", stage: "CONTACTED", days: -12, dueOn: "Nov 9", claim: { kind: "free" }, note: "Emailed the regional office." },
  { id: "fairview", name: "Fairview Pharmacy", stage: "REPLIED", days: -16, dueOn: "Nov 13", claim: { kind: "theirs", who: "Sam L.", until: "Nov 12" }, note: "Owner will check with the franchise." },
  { id: "ostrander", name: "Ostrander Plastics", stage: "CONTACTED", days: -20, dueOn: "Nov 17", claim: { kind: "free" }, note: "Introduced through a Purdue alum." },
  { id: "delancey", name: "Delancey Bank", stage: "REPLIED", days: -24, dueOn: "Nov 21", claim: { kind: "free" }, note: "Branch manager asked for a one page summary." },
  { id: "hadley", name: "Hadley Welding Supply", stage: "CONTACTED", days: -28, dueOn: "Nov 25", claim: { kind: "free" }, note: "Called twice, left a message." },
  { id: "marlow", name: "Marlow Logistics", stage: "IN_CONVERSATION", days: -31, dueOn: "Nov 28", claim: { kind: "theirs", who: "Dev P.", until: "Nov 9" }, note: "Meeting set for after break." },
  { id: "quarry", name: "Quarry Street Bakery", stage: "CONTACTED", days: -35, dueOn: "Dec 2", claim: { kind: "free" }, note: "Owner prefers a phone call." },
];
