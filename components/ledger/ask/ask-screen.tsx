"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { askQuestion, chooseStarter, removeChip, showAgain, startConversation } from "@/app/(app)/[workspaceId]/ask/actions";
import { focusSoon } from "@/components/ledger/focus";
import { preloadMotion } from "@/components/ledger/motion-kit";
import { OverflowMenu } from "@/components/ledger/overflow-menu";
import { ErrorLine, PageHead } from "@/components/ledger/shared";
import { StarterChips } from "./answer-parts";
import { handedOverDraft } from "./question";
import { announcement, collapse, failedEntry, fromAnswer, initialEntries, pendingEntry, withAnswer } from "./entries";
import { Turn } from "./turn";
import type { ActionCard, CopilotAnswer, Entry, FilterChip, Starter, TurnView } from "./types";

// Ask Coppice. The thread, newest at the bottom, and the question box pinned at the foot. A typed
// question is the one thing that calls the AI. Starter chips, filter chips, next-move chips, "Show
// again" and "New conversation" do not. While a question is on its way the box stays where it is
// (read only, not disabled), so focus is never lost; when the answer arrives focus is still in the
// box, and a polite live region reads the answer aloud.

// The longest question the server takes (COPILOT_QUESTION_MAX in lib/validation.ts).
const QUESTION_MAX = 500;
const PLACEHOLDER = "Ask about your pipeline or how Coppice works";
const UNREACHABLE = "Coppice couldn't reach the server just now. Nothing was changed. Try again.";

let counter = 0;
const newKey = () => `ask-${Date.now().toString(36)}-${counter++}`;

export function AskScreen({
  workspaceId,
  today,
  groqConfigured,
  threadId: initialThread,
  turns,
  latest,
  starters,
}: {
  workspaceId: string;
  today: string;
  groqConfigured: boolean;
  threadId: string | null;
  turns: TurnView[];
  latest: CopilotAnswer | null;
  starters: Starter[];
}) {
  const [entries, setEntries] = useState<Entry[]>(() => initialEntries(turns, latest));
  const [threadId, setThreadId] = useState<string | null>(initialThread);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState<{ n: number; text: string }>({ n: 0, text: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLOListElement>(null);
  const busy = useRef(false);
  const entriesRef = useRef(entries);
  const threadRef = useRef(threadId);
  const scrollTo = useRef<string | null>(null);
  const hintId = useId();

  useEffect(() => {
    entriesRef.current = entries;
    threadRef.current = threadId;
  });

  // The next move is likely to confirm a card, so the motion kit is fetched ahead of time (it plays
  // only when something is finished or removed).
  const hasCards = entries.some((e) => (e.answer?.cards.length ?? 0) > 0 || (e.answer?.rows.length ?? 0) > 0 || e.answer?.company);
  useEffect(() => {
    if (hasCards) preloadMotion();
  }, [hasCards]);

  // After a change the newest turn comes into view, at its question.
  useEffect(() => {
    const key = scrollTo.current;
    if (!key) return;
    scrollTo.current = null;
    thread.current?.querySelector(`[data-entry="${key}"]`)?.scrollIntoView({ block: "start" });
  }, [entries]);

  // Focus stays in the question box. A chip or button that had it and is gone hands it back here;
  // someone who has moved on (a link, another control) is left where they are.
  const keepFocus = useCallback(() => {
    focusSoon(() => {
      const active = document.activeElement;
      const box = input.current;
      if (!box) return null;
      const lost = !active || active === document.body || !active.isConnected;
      return lost || active === box || thread.current?.contains(active) ? box : null;
    });
  }, []);

  const guarded = useCallback(async (job: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      await job();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }, []);

  const hear = useCallback((answer: CopilotAnswer) => setHeard((h) => ({ n: h.n + 1, text: announcement(answer) })), []);

  // One typed question: the only call to the AI. `retryOf` is a failed turn this asks again.
  const ask = useCallback(
    (question: string, retry: Entry | null = null) =>
      guarded(async () => {
        const key = newKey();
        setProblem(null);
        setEntries((list) => [...collapse(retry ? list.filter((e) => e.key !== retry.key) : list), pendingEntry(key, question)]);
        scrollTo.current = key;
        let failed: Parameters<typeof failedEntry>[1];
        try {
          const result = await askQuestion({ workspaceId, threadId: threadRef.current, question, retryOf: retry?.turnId ?? null });
          if (result.ok) {
            setThreadId(result.data.threadId);
            scrollTo.current = key;
            setEntries((list) => list.map((e) => (e.key === key ? fromAnswer(key, result.data) : e)));
            hear(result.data);
            keepFocus();
            return;
          }
          if (result.threadId) setThreadId(result.threadId);
          failed = result;
        } catch {
          failed = { error: UNREACHABLE, turnId: null, retryable: false, rateLimited: false };
        }
        const done = failed;
        setEntries((list) => list.map((e) => (e.key === key ? failedEntry(e, done) : e)));
        keepFocus();
      }),
    [guarded, workspaceId, hear, keepFocus],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy.current) return;
    setDraft("");
    void ask(text);
  };

  // A question handed over by the search palette (?q=) goes into the box and the box gets focus; the
  // person presses Ask. Nothing is asked on its own, so a link anyone pasted can't spend a call. The
  // address is cleaned so a reload doesn't fill the box again.
  const pathname = usePathname();
  const handedOver = useSearchParams().get("q");
  const lastHanded = useRef<string | null>(null);
  useEffect(() => {
    const text = handedOverDraft(handedOver, QUESTION_MAX);
    if (!text) {
      lastHanded.current = null;
      return;
    }
    if (lastHanded.current === text) return;
    lastHanded.current = text;
    window.history.replaceState(null, "", pathname);
    setDraft(text);
    focusSoon(() => input.current);
  }, [handedOver, pathname]);

  const starter = useCallback(
    (pick: Starter) =>
      guarded(async () => {
        const key = newKey();
        setProblem(null);
        setEntries((list) => [...collapse(list), pendingEntry(key, pick.label)]);
        scrollTo.current = key;
        let result: Awaited<ReturnType<typeof chooseStarter>>;
        try {
          result = await chooseStarter({ workspaceId, threadId: threadRef.current, starter: pick.id });
        } catch {
          result = { ok: false, error: UNREACHABLE };
        }
        if (result.ok) {
          setThreadId(result.data.threadId);
          scrollTo.current = key;
          setEntries((list) => list.map((e) => (e.key === key ? fromAnswer(key, result.data) : e)));
          hear(result.data);
        } else {
          setEntries((list) => list.filter((e) => e.key !== key));
          setProblem(result.error);
        }
        keepFocus();
      }),
    [guarded, workspaceId, hear, keepFocus],
  );

  // "Show again": an older turn read fresh from its stored intent.
  const again = useCallback(
    (entry: Entry) =>
      guarded(async () => {
        if (!entry.turnId) return;
        setProblem(null);
        const result = await showAgain({ workspaceId, turnId: entry.turnId, filter: null }).catch(() => null);
        if (result?.ok) {
          setEntries((list) => withAnswer(list, entry.key, result.data));
          hear(result.data);
          focusSoon(() => thread.current?.querySelector<HTMLElement>(`[data-entry="${entry.key}"] .lg-askq`) ?? null);
        } else {
          setEntries((list) => list.map((e) => (e.key === entry.key ? { ...e, problem: result?.error ?? UNREACHABLE } : e)));
        }
      }),
    [guarded, workspaceId, hear],
  );

  // A filter chip taken off: the list again without it, no AI call.
  const dropChip = useCallback(
    (entry: Entry, key: FilterChip["key"]) =>
      guarded(async () => {
        if (!entry.turnId || !entry.answer?.filter) return;
        const result = await removeChip({ workspaceId, turnId: entry.turnId, filter: entry.answer.filter, remove: key }).catch(() => null);
        if (result?.ok) {
          setEntries((list) => withAnswer(list, entry.key, result.data));
          hear(result.data);
          focusSoon(() => thread.current?.querySelector<HTMLElement>(`[data-entry="${entry.key}"] [data-ask-chips] button:not([disabled])`) ?? thread.current?.querySelector<HTMLElement>(`[data-entry="${entry.key}"] .lg-askq`) ?? null);
        } else {
          setEntries((list) => list.map((e) => (e.key === entry.key ? { ...e, problem: result?.error ?? UNREACHABLE } : e)));
        }
      }),
    [guarded, workspaceId, hear],
  );

  // After a confirmed change the rows are read again (a claim shows as yours, a date has moved).
  // Quiet: a failure here leaves what is on screen.
  const refresh = useCallback(
    async (entry: Entry) => {
      if (!entry.turnId || !entry.answer || busy.current) return;
      const result = await showAgain({ workspaceId, turnId: entry.turnId, filter: null }).catch(() => null);
      if (result?.ok && entriesRef.current.some((e) => e.key === entry.key && e.answer)) {
        setEntries((list) => list.map((e) => (e.key === entry.key && e.answer ? fromAnswer(e.key, result.data, e.doneCards) : e)));
      }
    },
    [workspaceId],
  );

  const cardLeft = useCallback((entry: Entry, card: ActionCard) => {
    setEntries((list) => list.map((e) => (e.key === entry.key ? { ...e, doneCards: [...e.doneCards, card.key] } : e)));
  }, []);

  const fresh = useCallback(
    () =>
      guarded(async () => {
        setProblem(null);
        const result = await startConversation(workspaceId).catch(() => null);
        if (!result?.ok) {
          setProblem(result?.error ?? UNREACHABLE);
          return;
        }
        setThreadId(result.data.threadId);
        setEntries([]);
        setHeard((h) => ({ n: h.n + 1, text: "New conversation." }));
        focusSoon(() => input.current);
      }),
    [guarded, workspaceId],
  );

  const empty = entries.length === 0;
  return (
    <div className="lg-page-ask" data-empty={empty || undefined}>
      <PageHead title="Ask Coppice" sub="Ask about your pipeline or how Coppice works. Answers are read from your workspace.">
        {!empty && <OverflowMenu label="More actions for Ask Coppice" items={[{ key: "new", label: "New conversation", hint: "Starts a clean thread", onSelect: () => void fresh() }]} />}
      </PageHead>

      <p className="lg-sr" role="status" aria-live="polite" key={heard.n}>
        {heard.text}
      </p>

      {empty ? (
        <div className="lg-askstart">
          <p className="lg-askstart-lead">Try one of these, or ask your own question below.</p>
          <StarterChips starters={starters} onPick={(s) => void starter(s)} disabled={working} />
        </div>
      ) : (
        <ol ref={thread} className="lg-askthread" aria-label="Conversation">
          {entries.map((entry) => (
            <Turn
              key={entry.key}
              entry={entry}
              workspaceId={workspaceId}
              today={today}
              starters={starters}
              busy={working}
              onShowAgain={(e) => void again(e)}
              onRemoveChip={(e, key) => void dropChip(e, key)}
              onRetry={(e) => void ask(e.question, e)}
              onStarter={(s) => void starter(s)}
              onCardLeft={cardLeft}
              onChanged={(e) => void refresh(e)}
            />
          ))}
        </ol>
      )}

      {problem && <ErrorLine>{problem}</ErrorLine>}

      <form className="lg-askform" onSubmit={submit}>
        <label htmlFor={`${hintId}-q`} className="lg-sr">
          {PLACEHOLDER}
        </label>
        <div className="lg-askform-row">
          <input
            ref={input}
            id={`${hintId}-q`}
            type="text"
            className="lg-input lg-askinput"
            placeholder={PLACEHOLDER}
            autoComplete="off"
            maxLength={QUESTION_MAX}
            readOnly={working}
            aria-busy={working || undefined}
            aria-describedby={groqConfigured ? undefined : `${hintId}-hint`}
            data-tour="ask-coppice"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="lg-btn lg-btn-primary lg-askgo" disabled={working || draft.trim() === ""}>
            Ask
          </button>
        </div>
        {!groqConfigured && (
          <p id={`${hintId}-hint`} className="lg-hint">
            Typed questions need a Groq key on this server. The starter chips still work.
          </p>
        )}
      </form>
    </div>
  );
}
