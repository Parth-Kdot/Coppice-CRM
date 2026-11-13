import { describe, expect, it, test } from "vitest";
import { announcement, collapse, failedEntry, fromAnswer, fromTurn, initialEntries, pendingEntry, withAnswer } from "@/components/ledger/ask/entries";
import { asksQuestion } from "@/components/ledger/ask/question";
import type { CopilotAnswer, Entry, TurnView } from "@/components/ledger/ask/types";

// The thread the Ask Coppice screen keeps, and when the search palette offers to ask a question.
// Pure functions, no browser.

const answer = (rest: Partial<CopilotAnswer> = {}): CopilotAnswer =>
  ({
    threadId: "th1",
    turnId: "t1",
    question: "Who's overdue?",
    createdAt: "2026-11-13T12:00:00.000Z",
    reply: "These are overdue.",
    view: "companies",
    notes: [],
    filter: null,
    chips: [{ key: "due", label: "Overdue", removable: true }],
    summary: "3 companies match.",
    total: 3,
    rows: [],
    company: null,
    stats: null,
    guide: [],
    cards: [],
    applyAll: false,
    showStarters: false,
    ...rest,
  }) as CopilotAnswer;

const turn = (rest: Partial<TurnView> = {}): TurnView => ({
  turnId: "t1",
  question: "Who's overdue?",
  reply: "These are overdue.",
  status: "ANSWERED",
  error: null,
  retryable: false,
  view: "companies",
  chips: [],
  createdAt: "2026-11-13T12:00:00.000Z",
  ...rest,
});

describe("what the palette treats as a question", () => {
  test.each([
    ["who's overdue?", true],
    ["Acme?", true],
    ["what should I do today", true],
    ["  who is held by others  ", true],
    ["acme", false],
    ["acme tech", false],
    ["follow up this week", true],
    ["follow up soon", false],
    ["", false],
    ["   ", false],
  ])("%j is %s", (text, expected) => {
    expect(asksQuestion(text)).toBe(expected);
  });
});

describe("the thread", () => {
  it("starts from the reloaded turns, with rows only on the newest answered one", () => {
    const entries = initialEntries([turn({ turnId: "t1" }), turn({ turnId: "t2", question: "only mine" })], answer({ turnId: "t2", question: "only mine" }));
    expect(entries.map((e) => [e.key, e.answer?.turnId ?? null])).toEqual([
      ["t1", null],
      ["t2", "t2"],
    ]);
  });

  it("shows a failed turn as a failure with its line, and an answered one as an answer", () => {
    expect(fromTurn(turn({ status: "FAILED", error: "The AI took too long to answer. Try again.", retryable: true, reply: "" }))).toMatchObject({
      status: "failed",
      error: "The AI took too long to answer. Try again.",
      retryable: true,
    });
    expect(fromTurn(turn())).toMatchObject({ status: "answered", error: null, answer: null, view: "companies" });
  });

  it("has a pending entry for a question on its way, and a failure keeps the turn the server saved", () => {
    const pending = pendingEntry("k1", "Who's overdue?");
    expect(pending).toMatchObject({ status: "pending", turnId: null, answer: null, doneCards: [] });
    expect(failedEntry(pending, { error: "Busy.", turnId: "t9", retryable: true, rateLimited: true })).toMatchObject({
      status: "failed",
      turnId: "t9",
      error: "Busy.",
      retryable: true,
      rateLimited: true,
      question: "Who's overdue?",
    });
  });

  it("keeps rows on one entry at a time", () => {
    const first = fromAnswer("a", answer({ turnId: "t1" }));
    const second = fromAnswer("b", answer({ turnId: "t2" }));
    expect(collapse([first, second]).map((e) => e.answer)).toEqual([null, null]);
    // Reading an older turn again gives it the rows and takes them from the other.
    const swapped = withAnswer([{ ...first, answer: null }, second], "a", answer({ turnId: "t1" }));
    expect(swapped.map((e) => e.answer?.turnId ?? null)).toEqual(["t1", null]);
  });

  it("remembers the cards already confirmed when the answer is read again", () => {
    const entry: Entry = { ...fromAnswer("a", answer()), doneCards: ["CLAIM:c1:0"] };
    const [again] = withAnswer([entry], "a", answer({ reply: "Fresh." }));
    expect(again.doneCards).toEqual(["CLAIM:c1:0"]);
    expect(again.reply).toBe("Fresh.");
  });

  it("reads out the sentence and the code-built summary", () => {
    expect(announcement(answer())).toBe("These are overdue. 3 companies match.");
    expect(announcement(answer({ summary: null }))).toBe("These are overdue.");
  });
});
