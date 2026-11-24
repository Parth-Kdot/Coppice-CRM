"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, WarningIcon } from "./icons";
import "./ledger.css";

// Two small services every Ledger screen shares: margin notes (the one place feedback is written)
// and a confirmation dialog.

// ----- Margin notes -----

// A note may carry one follow-up (e.g. "See it" after a slip moved off screen); it then holds longer.
// `avoid` names what the note must not cover (the heading a fact just landed on): the lane moves to
// the top of the screen instead while it would.
export type NoteOptions = { action?: { label: string; onSelect: () => void }; avoid?: Element | null };
type Note = { id: number; text: string; tone: "ok" | "error"; action?: NoteOptions["action"] };
type Notify = (text: string, tone?: "ok" | "error", options?: NoteOptions) => void;

// At most two notes at once, each held briefly (the CSS fade-out starts just before the timer).
const MAX_NOTES = 2;
const HOLD_MS = 2700;
const HOLD_ACTION_MS = 6000;

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// Where the lane sits: at the foot of the page column, unless a note there would lie over what the
// person is working on (the focused control, or what the caller asked to keep clear). Then it moves
// to the top, under the header, for as long as notes are showing. Measured, so it holds on any page.
function placeLane(lane: HTMLElement, avoid: (Element | null | undefined)[]) {
  // The focused control with the small form around it (an open editor's Save sits beside its field).
  const active = document.activeElement;
  const form = active?.closest("form");
  const focused = form && form.getBoundingClientRect().height < window.innerHeight / 2 ? form : active;
  const keep = [focused, ...avoid].filter(
    (el): el is Element => el instanceof Element && el !== document.body && el !== document.documentElement && !lane.contains(el),
  );
  lane.removeAttribute("data-at");
  lane.style.removeProperty("top");
  if (keep.length === 0 || lane.childElementCount === 0) return;
  const covers = () => {
    const r = lane.getBoundingClientRect();
    return keep.some((el) => overlaps(r, el.getBoundingClientRect()));
  };
  if (!covers()) return;
  const head = document.querySelector(".lg-head")?.getBoundingClientRect();
  lane.setAttribute("data-at", "top");
  lane.style.setProperty("top", `${Math.max(12, Math.round((head?.bottom ?? 0) + 10))}px`);
  if (covers()) {
    // Both places are in the way (a very tall control): the foot it is.
    lane.removeAttribute("data-at");
    lane.style.removeProperty("top");
  }
}

const NoteContext = createContext<Notify>(() => undefined);
export const useNotify = (): Notify => useContext(NoteContext);

// The workspace shell has its own lane for notes, fixed at the foot of the page column and empty
// when idle (above the tab bar on a phone). Screens without the shell (the workspace list) get a
// fixed lane at the bottom left instead.
const NoteLaneContext = createContext<(el: HTMLElement | null) => void>(() => undefined);
export const useNoteLane = () => useContext(NoteLaneContext);
// A modal sheet (the board's look-alikes) makes the rest of the page inert, so while one is
// open it offers a lane of its own and notes are written there instead, where they can be seen and
// are read aloud.
const SheetNoteLaneContext = createContext<(el: HTMLElement | null) => void>(() => undefined);
export const useSheetNoteLane = () => useContext(SheetNoteLaneContext);

// ----- Confirm -----

type ConfirmOptions = { message: string; confirmLabel?: string; cancelLabel?: string; title?: string };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false));
export const useConfirm = (): Confirm => useContext(ConfirmContext);

export function LedgerProviders({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [lane, setLane] = useState<HTMLElement | null>(null);
  const [sheetLane, setSheetLane] = useState<HTMLElement | null>(null);
  const nextId = useRef(1);
  const timers = useRef<Set<number>>(new Set());
  const fallbackLane = useRef<HTMLDivElement>(null);
  // What the newest note must not cover, read when the lane is placed.
  const avoid = useRef<Element | null>(null);

  const notify = useCallback<Notify>((text, tone = "ok", options) => {
    const id = nextId.current++;
    avoid.current = options?.avoid ?? null;
    setNotes((current) => [...current.slice(-(MAX_NOTES - 1)), { id, text, tone, action: options?.action }]);
    const timer = window.setTimeout(
      () => {
        timers.current.delete(timer);
        setNotes((current) => current.filter((n) => n.id !== id));
      },
      options?.action ? HOLD_ACTION_MS : HOLD_MS,
    );
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pending && dialog && !dialog.open) dialog.showModal();
  }, [pending]);

  const finish = (ok: boolean) => {
    const current = pending;
    setPending(null);
    dialogRef.current?.close();
    current?.resolve(ok);
  };

  const noteTarget = sheetLane ?? lane;
  const dismiss = (id: number) => setNotes((current) => current.filter((n) => n.id !== id));
  const noteList = notes.map((note) => (
    <p key={note.id} className={`lg-note ${note.tone === "error" ? "lg-note-error" : "lg-note-ok"}${note.action ? " lg-note-long" : ""}`}>
      {note.tone === "error" ? <WarningIcon size={16} /> : <CheckIcon size={16} />}
      <span>{note.text}</span>
      {note.action && (
        <button
          type="button"
          className="lg-linkbtn lg-note-act"
          onClick={() => {
            dismiss(note.id);
            note.action?.onSelect();
          }}
        >
          {note.action.label}
        </button>
      )}
    </p>
  ));

  // Place the page's lane each time a note is written, and again if focus moves (or is scrolled)
  // under it while notes are showing. A sheet's own lane stays where the sheet puts it.
  const newest = notes.at(-1)?.id;
  useLayoutEffect(() => {
    const pageLane = sheetLane ? null : (lane ?? fallbackLane.current);
    if (!pageLane) return;
    if (newest === undefined) {
      pageLane.removeAttribute("data-at");
      pageLane.style.removeProperty("top");
      return;
    }
    placeLane(pageLane, [avoid.current]);
    // Again when focus moves, or the page scrolls what has focus under the lane (once per frame).
    let frame = 0;
    const again = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeLane(pageLane, [avoid.current]);
      });
    };
    document.addEventListener("focusin", again);
    window.addEventListener("scroll", again, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", again);
      window.removeEventListener("scroll", again);
    };
  }, [sheetLane, lane, newest]);

  return (
    <NoteContext.Provider value={notify}>
      <NoteLaneContext.Provider value={setLane}>
        <SheetNoteLaneContext.Provider value={setSheetLane}>
          <ConfirmContext.Provider value={confirm}>
            {children}
            {noteTarget ? (
              createPortal(noteList, noteTarget)
            ) : (
              <div ref={fallbackLane} className="lg-notes" aria-live="polite" aria-atomic="false">
                {noteList}
              </div>
            )}
            <dialog
              ref={dialogRef}
              className="lg-dialog"
              aria-labelledby="lg-confirm-message"
              onCancel={(event) => {
                event.preventDefault();
                finish(false);
              }}
              onClick={(event) => {
                if (event.target === dialogRef.current) finish(false);
              }}
            >
              {pending && (
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <WarningIcon className="mt-0.5 flex-none text-ink-2" />
                    <p id="lg-confirm-message" className="font-display text-[length:var(--fs-4)] font-normal leading-snug">
                      {pending.options.message}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button type="button" className="lg-btn whitespace-normal" onClick={() => finish(false)} autoFocus>
                      {pending.options.cancelLabel ?? "Cancel"}
                    </button>
                    <button type="button" className="lg-btn lg-btn-primary whitespace-normal text-left" onClick={() => finish(true)}>
                      {pending.options.confirmLabel ?? "Yes, continue"}
                    </button>
                  </div>
                </div>
              )}
            </dialog>
          </ConfirmContext.Provider>
        </SheetNoteLaneContext.Provider>
      </NoteLaneContext.Provider>
    </NoteContext.Provider>
  );
}
