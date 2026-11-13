import type { ActionCard, CopilotAnswer, CopilotView, FilterChip, TurnView } from "@/lib/copilot";

// What the Ask Coppice screen keeps for each question in the thread. Only the newest answered turn
// (or one the person asked to see again) carries its full `answer` with rows and cards; the rest are
// a question, a sentence and the filter chips, like a reloaded thread.
export type { ActionCard, CopilotAnswer, CopilotView, FilterChip, TurnView };

export type Entry = {
  // Stable in the browser, so React keeps an entry's state when its turn id arrives.
  key: string;
  // null while the question is on its way, or when it failed before anything was saved.
  turnId: string | null;
  question: string;
  status: "pending" | "answered" | "failed";
  reply: string;
  view: CopilotView;
  chips: FilterChip[];
  answer: CopilotAnswer | null;
  // A failure, in plain words, and what can be done about it.
  error: string | null;
  retryable: boolean;
  rateLimited: boolean;
  // A problem with something done on an answered turn (a chip edit that was refused).
  problem: string | null;
  // Cards already confirmed, kept so a fresh read of the answer doesn't bring them back.
  doneCards: string[];
};

export type Starter = { id: string; label: string };
