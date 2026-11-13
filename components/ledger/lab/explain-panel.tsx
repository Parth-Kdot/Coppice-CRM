"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { explainStats } from "@/app/(app)/[workspaceId]/stats/actions";
import { focusSoon } from "@/components/ledger/focus";
import { QuillWait } from "@/components/ledger/marks";
import { ErrorLine } from "@/components/ledger/shared";
import type { ActionResult } from "@/lib/validation";
import "../pages.css";
import "../stats.css";
import "./lab.css";

// "Explain these numbers": the stored explanation of the stats page, in words, with every number a
// chip. The chips are drawn from the facts STORED with the explanation (their text is the number as
// the page formats it, their title says what it is), so a number on screen can never be one the
// model wrote. The button is the only thing that calls the AI, and only on a click; a page load
// never does. If today's numbers differ from the ones the explanation was written about, a quiet
// line says so and the button is offered again.

export type ExplainSegment = { kind: "words"; text: string } | { kind: "fact"; key: string; text: string; what: string };

type Props = {
  workspaceId: string;
  // The stored explanation, or null if none has been written.
  paragraphs: ExplainSegment[][] | null;
  // "Written by Dana on Nov 13".
  written: string | null;
  // Today's numbers differ from the ones it was written about.
  changed: boolean;
  // How many sentences the checks left out before it was stored (a quiet line shows only when above 0).
  dropped?: number;
  // AI is set up and on for the workspace: without it the button is not drawn at all.
  canAsk: boolean;
  // The workspace has used its AI calls for the window, so the click would be refused.
  limitLine: string | null;
};

export function ExplainPanel({ workspaceId, paragraphs, written, changed, dropped = 0, canAsk, limitLine }: Props) {
  const id = useId();
  const [state, action, pending] = useActionState((prev: ActionResult | null, form: FormData) => explainStats(prev, form), null);
  const button = useRef<HTMLButtonElement>(null);
  const text = useRef<HTMLDivElement>(null);
  // The chip the person last pressed, spelled out under the text (a title alone is no help on a phone).
  const [open, setOpen] = useState<{ p: number; i: number } | null>(null);

  // The button is disabled while the call runs, which drops focus to the page: when the answer comes
  // back focus goes to the new text, or back to the button after a refusal.
  useEffect(() => {
    if (!state || document.activeElement !== document.body) return;
    focusSoon(state.ok ? () => text.current : button.current);
  }, [state]);

  const hasText = paragraphs !== null && paragraphs.length > 0;
  const stale = hasText && changed;
  const label = !hasText || stale ? "Explain these numbers" : "Write it again";
  const shownFact = open ? paragraphs?.[open.p]?.[open.i] : null;

  return (
    <section className="lg-panel lg-explain" aria-labelledby={`${id}-h`} data-has-text={hasText || undefined}>
      <div className="lg-panel-head">
        <h2 id={`${id}-h`} className="lg-panel-title">
          In plain words
        </h2>
        {hasText && written && <span className="lg-panel-count">{written}</span>}
      </div>
      <div className="lg-panel-body">
        {stale && (
          <p className="lg-hint lg-explain-stale lg-explain-first" data-tone="changed">
            The numbers have changed since this was written.
          </p>
        )}
        {hasText && (
          <div ref={text} tabIndex={-1} className="lg-explain-text" aria-label="The numbers in plain words">
            {paragraphs.map((paragraph, p) => (
              <p key={p}>
                {paragraph.map((segment, i) =>
                  segment.kind === "words" ? (
                    <span key={i}>{segment.text}</span>
                  ) : (
                    <FactChip
                      key={i}
                      segment={segment}
                      pressed={open?.p === p && open.i === i}
                      onPress={() => setOpen(open?.p === p && open.i === i ? null : { p, i })}
                    />
                  ),
                )}
              </p>
            ))}
          </div>
        )}
        {hasText && dropped > 0 && (
          <p className="lg-hint lg-explain-dropped">
            {dropped === 1 ? "1 sentence was left out by the checks." : `${dropped} sentences were left out by the checks.`}
          </p>
        )}
        {shownFact?.kind === "fact" && (
          <p className="lg-hint lg-explain-what" role="status">
            <strong>{shownFact.text}</strong> is {shownFact.what}.
          </p>
        )}
        {!hasText && (
          <p className="lg-hint lg-explain-intro">
            Coppice reads the numbers above out in a few short paragraphs. It only repeats numbers this page already shows, and it never ranks anything
            the table does not.
          </p>
        )}

        {canAsk && (
          <form action={action} className="lg-explain-ask">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <button
              ref={button}
              type="submit"
              disabled={pending || limitLine !== null}
              data-tour="explain-stats"
              className={`lg-btn ${!hasText || stale ? "lg-btn-primary" : "lg-btn-sm"}`}
            >
              {pending ? "Explaining..." : label}
            </button>
            <p className="lg-hint">Uses an AI call. Sends Google the template names and the numbers on this page, nothing else.</p>
            {limitLine && <ErrorLine>{limitLine}</ErrorLine>}
            {state && !state.ok && !limitLine && <ErrorLine>{state.error}</ErrorLine>}
          </form>
        )}
        {pending && <QuillWait label="Reading the numbers. This usually takes a few seconds." />}
      </div>
    </section>
  );
}

// A number (or a name) the page's own facts hold. A button, so it works by keyboard and on touch:
// pressing it spells out what the number is.
function FactChip({ segment, pressed, onPress }: { segment: Extract<ExplainSegment, { kind: "fact" }>; pressed: boolean; onPress: () => void }) {
  const id = useId();
  const kind = segment.key.endsWith(".name") ? "name" : "number";
  return (
    <>
      <button type="button" className="lg-fact" data-kind={kind} aria-pressed={pressed} aria-describedby={id} title={segment.what} onClick={onPress}>
        {segment.text}
      </button>
      <span id={id} className="lg-sr">
        {segment.what}
      </span>
    </>
  );
}
