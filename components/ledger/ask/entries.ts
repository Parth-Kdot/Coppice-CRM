import type { CopilotAnswer, Entry, TurnView } from "./types";

// The thread as the screen keeps it, and the small moves between its states. Pure, so they are
// tested directly (tests/ask-entries.test.ts). Only one answered turn at a time carries its rows:
// the newest, or the one the person asked to see again. Every other turn is a question, a sentence
// and chips, which is exactly what a reloaded thread has.

const blank = (): Omit<Entry, "key" | "question" | "status"> => ({
  turnId: null,
  reply: "",
  view: "none",
  chips: [],
  answer: null,
  error: null,
  retryable: false,
  rateLimited: false,
  problem: null,
  doneCards: [],
});

export const pendingEntry = (key: string, question: string): Entry => ({ ...blank(), key, question, status: "pending" });

export function fromAnswer(key: string, answer: CopilotAnswer, doneCards: string[] = []): Entry {
  return { ...blank(), key, turnId: answer.turnId, question: answer.question, status: "answered", reply: answer.reply, view: answer.view, chips: answer.chips, answer, doneCards };
}

export function fromTurn(turn: TurnView): Entry {
  const failed = turn.status === "FAILED";
  return {
    ...blank(),
    key: turn.turnId,
    turnId: turn.turnId,
    question: turn.question,
    status: failed ? "failed" : "answered",
    reply: turn.reply,
    view: turn.view,
    chips: turn.chips,
    error: turn.error,
    retryable: turn.retryable,
    doneCards: [],
  };
}

// A question that got no answer. `retryable` and `rateLimited` come from the server's failure.
export function failedEntry(entry: Entry, failure: { error: string; turnId: string | null; retryable: boolean; rateLimited: boolean }): Entry {
  return { ...entry, status: "failed", turnId: failure.turnId, error: failure.error, retryable: failure.retryable, rateLimited: failure.rateLimited };
}

// Every entry without its rows, so the one just answered is the only one that has them.
export const collapse = (entries: Entry[]): Entry[] => entries.map((e) => (e.answer ? { ...e, answer: null } : e));

// The thread a reloaded page starts from: every turn, and the newest answered turn's rows.
export function initialEntries(turns: TurnView[], latest: CopilotAnswer | null): Entry[] {
  return turns.map((turn) => {
    const entry = fromTurn(turn);
    return latest && latest.turnId === turn.turnId ? fromAnswer(entry.key, latest) : entry;
  });
}

// An answer read again for an entry already in the thread (Show again, a chip taken off, a refresh
// after a change): it takes the rows, and every other entry gives its rows up.
export function withAnswer(entries: Entry[], key: string, answer: CopilotAnswer): Entry[] {
  return entries.map((e) => (e.key === key ? fromAnswer(e.key, answer, e.doneCards) : e.answer ? { ...e, answer: null } : e));
}

// What a screen reader hears when an answer arrives: the sentence, then the code-built summary.
export const announcement = (answer: CopilotAnswer): string => [answer.reply, answer.summary].filter(Boolean).join(" ");
