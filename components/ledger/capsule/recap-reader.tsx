"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { CloseIcon } from "../icons";
import { celebrate, preloadMotion } from "../motion-kit";
import { CapsuleStamp } from "./stamp";
import { swipeFor, turnFor } from "./turn";
import type { RecapPage } from "./recap-pages";

// "Your year in Coppice": a run of full-height pages in a modal dialog, one big serif figure and one
// line each, on ruled paper with a margin line, like a keepsake page from the ledger. Next and Back
// buttons, the arrow keys (and Home and End), a swipe on touch, and pips like the tour's. The last
// page celebrates once with the motion kit; reduced motion plays nothing and every page is still
// one press away. Nothing here moves on its own: a page turn is instant.

export function RecapReader({ pages, label, primary }: { pages: RecapPage[]; label: string; primary: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`lg-btn ${primary ? "lg-btn-primary" : ""}`}
        aria-haspopup="dialog"
        data-tour="capsule-recap"
        onClick={() => {
          preloadMotion();
          setOpen(true);
        }}
      >
        Open your year
      </button>
      <dialog
        ref={dialog}
        className="lg-cap-recap"
        aria-label="Your year in Coppice"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        {open && <Pages pages={pages} label={label} onClose={() => dialog.current?.close()} />}
      </dialog>
    </>
  );
}

function Pages({ pages, label, onClose }: { pages: RecapPage[]; label: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const count = pages.length;
  const page = pages[index];
  const last = index === count - 1;
  const stamp = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);

  const go = (to: number) => setIndex(Math.min(count - 1, Math.max(0, to)));

  // The first control takes focus, so the keyboard works at once and the dialog's own first focus
  // (the close button) isn't where a person starts.
  useEffect(() => {
    primaryButton.current?.focus({ preventScroll: true });
  }, []);

  // Keeps focus on the main button as it turns into Close on the last page.
  useEffect(() => {
    if (last) primaryButton.current?.focus({ preventScroll: true });
  }, [last]);

  // The big finish, once, on the last page.
  useEffect(() => {
    if (page.kind !== "close" || celebrated.current) return;
    celebrated.current = true;
    void celebrate(stamp.current, { mark: stamp.current?.querySelector("[data-mark]") });
  }, [page.kind]);

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const turn = turnFor(event);
    if (!turn) return;
    event.preventDefault();
    go(turn === "next" ? index + 1 : turn === "back" ? index - 1 : turn === "first" ? 0 : count - 1);
  };
  const onTouchStart = (event: TouchEvent) => {
    const t = event.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const t = event.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const turn = swipeFor(t.clientX - start.x, t.clientY - start.y);
    if (turn) go(turn === "next" ? index + 1 : index - 1);
  };

  const withStamp = page.kind === "cover" || page.kind === "close";
  return (
    <div className="lg-cap-sheet" onKeyDown={onKey} data-kind={page.kind}>
      <div className="lg-cap-top">
        {count > 1 ? (
          <>
            <span className="lg-cap-pips" aria-hidden="true">
              {pages.map((p, i) => (
                <span key={p.key} data-state={i < index ? "done" : i === index ? "now" : undefined} />
              ))}
            </span>
            <span className="lg-cap-count lg-num">
              {index + 1} of {count}
            </span>
          </>
        ) : (
          <span className="lg-cap-count" />
        )}
        <button type="button" className="lg-btn lg-btn-sm lg-cap-close" onClick={onClose} aria-label="Close your year">
          <CloseIcon size={16} />
          <span>Close</span>
        </button>
      </div>

      <div className="lg-cap-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <section className="lg-cap-page" role="group" aria-roledescription="page" aria-label={count > 1 ? `Page ${index + 1} of ${count}` : "Your year"} aria-live="polite" aria-atomic="true">
          <p className="lg-cap-kicker">{page.kicker}</p>
          {withStamp && (
            <div className="lg-cap-stampwrap" ref={page.kind === "close" ? stamp : undefined}>
              <CapsuleStamp label={label} />
            </div>
          )}
          <p className="lg-cap-value" data-word={page.word || undefined}>
            {page.value}
          </p>
          <p className="lg-cap-line">{page.line}</p>
        </section>
      </div>

      <div className="lg-cap-nav">
        {index > 0 ? (
          <button type="button" className="lg-btn" onClick={() => go(index - 1)}>
            Back
          </button>
        ) : (
          <span className="lg-btn lg-cap-hold" aria-hidden="true">
            Back
          </span>
        )}
        {last ? (
          <button ref={primaryButton} type="button" className="lg-btn lg-btn-primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <button ref={primaryButton} type="button" className="lg-btn lg-btn-primary" onClick={() => go(index + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
