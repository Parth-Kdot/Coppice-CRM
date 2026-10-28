import type { Stage } from "@/demo/types";

// The made-up data behind the hero's small queue. It is its own little world, so the scripted
// scene can claim "Eli Lilly" without touching the prototype's mock state. Today in the scene is
// Oct 28, so a 14-day claim made now runs to Nov 11.

export type MiniClaim = { kind: "free" } | { kind: "mine"; until: string } | { kind: "theirs"; who: string; until: string };

export type MiniRow = {
  id: string;
  name: string;
  stage: Stage;
  // Days past the follow-up date. Zero is due today, negative is still ahead.
  days: number;
  claim: MiniClaim;
};

export const MINI_UNTIL = "Nov 11";
export const MINI_NEVER = 12;

// Most overdue first, the way the queue sorts. The levels run from long overdue down to upcoming.
export const MINI_ROWS: MiniRow[] = [
  { id: "toyota", name: "Toyota Motor", stage: "CONTACTED", days: 12, claim: { kind: "free" } },
  { id: "siemens", name: "Siemens", stage: "IN_CONVERSATION", days: 8, claim: { kind: "theirs", who: "Priya R.", until: "Oct 31" } },
  { id: "roche", name: "Roche Diagnostics", stage: "CONTACTED", days: 5, claim: { kind: "free" } },
  { id: "deere", name: "John Deere", stage: "CONTACTED", days: 4, claim: { kind: "free" } },
  { id: "lilly", name: "Eli Lilly", stage: "REPLIED", days: 3, claim: { kind: "free" } },
  { id: "cummins", name: "Cummins", stage: "CONTACTED", days: 1, claim: { kind: "theirs", who: "Marcus W.", until: "Nov 6" } },
  { id: "lockheed", name: "Lockheed Martin", stage: "CONTACTED", days: -2, claim: { kind: "free" } },
];

// What the keycap row under the window shows. Each group lights while its key is "pressed".
export const MINI_KEYS = [
  { id: "palette", keys: ["/", "⌘K"], label: "Search" },
  { id: "claim", keys: ["C"], label: "Claim" },
  { id: "log", keys: ["L"], label: "Log outreach" },
  { id: "move", keys: ["J", "K"], label: "Move" },
] as const;

// Which single caps are lit for a given beat of the script.
export const LIT_KEYS: Record<string, string[]> = {
  palette: ["/", "⌘K"],
  claim: ["C"],
  log: ["L"],
  j: ["J"],
  k: ["K"],
};
