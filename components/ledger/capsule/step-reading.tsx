"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildCodeCards, readHandoffChunk, startHandoff } from "@/app/(app)/[workspaceId]/capsule/actions";
import type { ChunkRead, OwnerView, ReportStart } from "@/lib/capsule";
import { CARD_AI_COMPANIES, CARD_COMPANIES_PER_CALL } from "@/lib/capsule/limits";
import { focusSoon } from "../focus";
import { ErrorLine } from "../shared";
import { plural } from "./format";
import { toForm, useRun } from "./use-run";

// Step 2, the relationship cards. The browser reads the chunks one after another, four companies
// to a call, exactly like Smart import: a progress meter, a pause button, a rate limit that waits a
// minute (counted down here, with Continue to go sooner), and a reload that picks up at the first
// chunk with no cards, because every chunk's cards are stored the moment it is read. Reading never
// starts by itself. "Skip the AI" makes facts-only cards for whatever has none yet, which is also
// how a workspace with AI off builds its handoff.

const METER_CELLS = 20;
const WAIT_SECONDS = 60;

type ReadError = { error: string; rateLimited: boolean; retryable: boolean };
type Tally = { kept: number; dropped: number; planted: number };

// After Groq's per-minute limit, the reading goes on by itself once the minute is up.
function AutoContinue({ onGo }: { onGo: () => void }) {
  const [left, setLeft] = useState(WAIT_SECONDS);
  const go = useRef(onGo);
  useEffect(() => {
    go.current = onGo;
  });
  useEffect(() => {
    if (left <= 0) {
      go.current();
      return;
    }
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return (
    <p className="lg-hint lg-cap-wait" data-testid="countdown">
      Going on by itself in <span aria-hidden="true">{left} s</span>
      <span className="lg-sr">a minute</span>.
    </p>
  );
}

const keptIn = (chunk: ChunkRead) => chunk.cards.reduce((sum, c) => sum + c.bullets, 0);
const droppedIn = (chunk: ChunkRead) => Object.values(chunk.dropped).reduce<number>((sum, n) => sum + (n ?? 0), 0);

export function StepReading({ workspaceId, year, view, locked }: { workspaceId: string; year: { start: number; label: string }; view: OwnerView | null; locked: boolean }) {
  const router = useRouter();
  const start = useRun<ReportStart>(startHandoff);
  const skip = useRun<{ created: number }>(buildCodeCards);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [doneChunks, setDoneChunks] = useState(view?.chunks.done ?? 0);
  const [readError, setReadError] = useState<ReadError | null>(null);
  const [tally, setTally] = useState<Tally>({ kept: 0, dropped: 0, planted: 0 });
  const [started, setStarted] = useState<ReportStart | null>(null);
  const [skipped, setSkipped] = useState<number | null>(null);
  const stop = useRef(false);
  // Where a failed reading stopped, so Continue picks up there even before the page has refreshed.
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  // What the server says is done wins whenever it sends a fresh view (after the page refreshes).
  const [seen, setSeen] = useState(view?.chunks.done);
  if (view?.chunks.done !== seen) {
    setSeen(view?.chunks.done);
    setDoneChunks(view?.chunks.done ?? 0);
    setResumeAt(null);
  }

  // When the last card is made the buttons go; focus moves on to Next rather than falling to the page.
  const complete = view ? view.chunks.next === null : false;
  const wasComplete = useRef(complete);
  useEffect(() => {
    if (!wasComplete.current && complete) focusSoon("#cap-next");
    wasComplete.current = complete;
  }, [complete]);

  const total = view?.chunks.total ?? 0;
  const ai = view?.ai;
  const canRead = !!ai && ai.on && ai.configured;
  const remaining = view?.chunks.next !== null && view?.chunks.next !== undefined;

  const readFrom = async (reportId: string, from: number) => {
    stop.current = false;
    setBusy(true);
    setReadError(null);
    let paused = false;
    for (let index = from; index < total; index++) {
      setCurrent(index);
      let res;
      try {
        res = await readHandoffChunk(null, toForm({ workspaceId, reportId, index: String(index) }));
      } catch {
        setResumeAt(index);
        setReadError({ error: "That didn't go through. Check your connection, then press Continue.", rateLimited: false, retryable: true });
        paused = true;
        break;
      }
      if (!res.ok) {
        setResumeAt(index);
        setReadError({ error: res.error, rateLimited: res.rateLimited, retryable: res.retryable === true || res.rateLimited });
        paused = true;
        break;
      }
      setResumeAt(index + 1);
      setDoneChunks(res.data.chunksDone);
      setTally((t) => ({ kept: t.kept + keptIn(res.data), dropped: t.dropped + droppedIn(res.data), planted: t.planted + res.data.plantedLeftOut }));
      if (stop.current) {
        paused = true;
        break;
      }
    }
    setBusy(false);
    setCurrent(null);
    // The button that started the call is gone while the message shows; Continue takes the focus.
    if (paused && !stop.current) focusSoon(".lg-cap-readerror [data-cap-primary]");
    // Refresh once reading stops, so the review step has every card.
    if (!paused || stop.current) router.refresh();
    return paused;
  };

  const next = (reportId: string) => readFrom(reportId, resumeAt ?? view?.chunks.next ?? 0);

  const onStart = async () => {
    const result = await start.run({ workspaceId, boardYearStart: String(year.start) });
    if (result?.ok) {
      setStarted(result.data);
      focusSoon("[data-cap-primary]");
    }
  };
  const onSkip = async () => {
    if (!view) return;
    const result = await skip.run({ workspaceId, reportId: view.report.id });
    if (result?.ok) {
      setSkipped(result.data.created);
      router.refresh();
    }
  };

  if (locked && view) {
    return (
      <div>
        <h3 className="lg-cap-steph">Relationship cards</h3>
        <p>
          {plural(view.counts.cards, "card", "cards")} for {view.report.label}, {plural(view.counts.approved, "approved", "approved")}. The handoff is published, so reading is closed.
        </p>
      </div>
    );
  }

  // No handoff yet for this board year.
  if (!view) {
    return (
      <div>
        <h3 className="lg-cap-steph">Relationship cards</h3>
        <p className="lg-muted lg-cap-stepsub">
          Coppice picks every company that has outreach in {year.label}, Committed first, then In conversation, Replied, Contacted and Declined. A card holds facts that code reads from your records: stage, outreach, replies, who logged it and the
          contacts. {canRead ? `The first ${CARD_AI_COMPANIES} companies also get notes read by AI, ${CARD_COMPANIES_PER_CALL} at a time.` : "Cards are made from those facts alone."}
        </p>
        <div className="lg-cap-actionrow">
          <button type="button" className="lg-btn lg-btn-primary" disabled={start.pending} onClick={onStart}>
            {start.pending ? "Working..." : `Find the companies for ${year.label}`}
          </button>
        </div>
        <ErrorLine>{start.error}</ErrorLine>
      </div>
    );
  }

  const aiCards = view.cards.filter((c) => c.source === "AI").length;
  const filled = total === 0 ? METER_CELLS : Math.round((doneChunks / total) * METER_CELLS);
  const finished = !remaining;
  const noAiReason = !ai?.on ? "AI is turned off for this workspace. An owner can turn it on in Settings." : !ai.configured ? "AI isn't set up on this server yet." : null;

  // When a call failed, the one Continue under the message is the way on, so the page does not show a second one.
  const retryHere = Boolean(readError && (readError.retryable || readError.rateLimited) && !busy);

  return (
    <div>
      <h3 className="lg-cap-steph">Relationship cards</h3>
      <p className="lg-muted lg-cap-stepsub">
        {plural(view.report.companies, "company has", "companies have")} outreach in {view.report.label}.
        {canRead ? ` Up to ${CARD_AI_COMPANIES} are read with AI, ${CARD_COMPANIES_PER_CALL} to a call. The rest, and any company with no notes, get facts only.` : " Every card is made from facts only."}
        {started && started.callsLeft !== null && started.callsLeft < total && ` The workspace has ${started.callsLeft} AI calls left in its 30 days, fewer than the ${total} this takes.`}
      </p>

      <div className="lg-usage lg-cap-progress">
        <p className="lg-usage-line" role="status">
          {finished
            ? `All ${plural(total, "call", "calls")} are done. ${plural(view.counts.cards, "card", "cards")} made, ${aiCards} read by AI, ${view.counts.cards - aiCards} facts only.`
            : busy && current !== null
              ? `Reading call ${current + 1} of ${total}...`
              : `${doneChunks} of ${plural(total, "call", "calls")} done.`}
        </p>
        <div className="lg-meter" aria-hidden="true">
          {Array.from({ length: METER_CELLS }, (_, i) => (
            <span key={i} data-on={i < filled || undefined} />
          ))}
        </div>
      </div>

      {(tally.kept > 0 || tally.dropped > 0 || tally.planted > 0) && (
        <p className="lg-hint lg-cap-tally">
          Checked by code: {plural(tally.kept, "bullet", "bullets")} kept
          {tally.dropped > 0 && `, ${plural(tally.dropped, "bullet", "bullets")} left out because the note didn't support it`}
          {tally.planted > 0 && `, ${plural(tally.planted, "note", "notes")} left out for reading like instructions to the AI`}.
        </p>
      )}

      {remaining && (
        <div className="lg-cap-actionrow">
          {canRead ? (
            <>
              {busy ? (
                <button type="button" className="lg-btn" onClick={() => (stop.current = true)}>
                  Pause after this call
                </button>
              ) : (
                !retryHere && (
                  <button type="button" data-cap-primary="" className="lg-btn lg-btn-primary" disabled={skip.pending} onClick={() => next(view.report.id)}>
                    {doneChunks > 0 ? "Continue reading" : "Read the notes with AI"}
                  </button>
                )
              )}
              <button type="button" className="lg-btn" disabled={busy || skip.pending} onClick={onSkip}>
                Skip the AI
              </button>
            </>
          ) : (
            <button type="button" data-cap-primary="" className="lg-btn lg-btn-primary" disabled={skip.pending} onClick={onSkip}>
              {skip.pending ? "Working..." : "Make the cards without AI"}
            </button>
          )}
        </div>
      )}
      {remaining && !canRead && noAiReason && <p className="lg-hint">{noAiReason} Cards without AI hold the facts only, and you can still review, approve and publish them.</p>}
      {remaining && canRead && <p className="lg-hint">Skip the AI makes facts-only cards for every company not read yet. Nothing is sent to AI then.</p>}

      {readError && (
        <div className="lg-cap-readerror">
          <ErrorLine>{readError.error}</ErrorLine>
          {retryHere && (
            <button type="button" data-cap-primary="" className="lg-btn lg-btn-primary" onClick={() => next(view.report.id)}>
              Continue
            </button>
          )}
          {readError.rateLimited && !busy && <AutoContinue key={doneChunks} onGo={() => next(view.report.id)} />}
          <p className="lg-hint">Cards already made are kept.</p>
        </div>
      )}
      <ErrorLine>{skip.error}</ErrorLine>
      {skipped !== null && finished && <p className="lg-cap-done" role="status">{skipped === 0 ? "Every company already has a card." : `Made ${plural(skipped, "card", "cards")} from facts alone.`}</p>}
    </div>
  );
}
