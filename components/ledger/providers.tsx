"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, WarningIcon } from "./icons";
import "./ledger.css";

// Two small services every Ledger screen shares: margin notes (the one place feedback is written)
// and a confirmation dialog.

// ----- Margin notes -----

type Note = { id: number; text: string; tone: "ok" | "error" };
type Notify = (text: string, tone?: "ok" | "error") => void;

const NoteContext = createContext<Notify>(() => undefined);
export const useNotify = (): Notify => useContext(NoteContext);

// The workspace shell has a lane for notes in its footer, so a note sits in the page's own margin
// and never lies over the rows. Screens without a footer (the workspace list) get a fixed lane at
// the bottom left instead.
const NoteLaneContext = createContext<(el: HTMLElement | null) => void>(() => undefined);
export const useNoteLane = () => useContext(NoteLaneContext);

// ----- Confirm -----

type ConfirmOptions = { message: string; confirmLabel?: string; cancelLabel?: string; title?: string };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false));
export const useConfirm = (): Confirm => useContext(ConfirmContext);

export function LedgerProviders({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [lane, setLane] = useState<HTMLElement | null>(null);
  const nextId = useRef(1);
  const timers = useRef<Set<number>>(new Set());

  const notify = useCallback<Notify>((text, tone = "ok") => {
    const id = nextId.current++;
    setNotes((current) => [...current.slice(-2), { id, text, tone }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setNotes((current) => current.filter((n) => n.id !== id));
    }, 3500);
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

  const noteList = notes.map((note) => (
    <p key={note.id} className={`lg-note ${note.tone === "error" ? "lg-note-error" : "lg-note-ok"}`}>
      {note.tone === "error" ? <WarningIcon size={16} /> : <CheckIcon size={16} />}
      <span>{note.text}</span>
    </p>
  ));

  return (
    <NoteContext.Provider value={notify}>
      <NoteLaneContext.Provider value={setLane}>
        <ConfirmContext.Provider value={confirm}>
          {children}
          {lane ? (
            createPortal(noteList, lane)
          ) : (
            <div className="lg-notes" aria-live="polite" aria-atomic="false">
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
                  <p id="lg-confirm-message" className="font-display text-[length:var(--fs-4)] font-medium leading-snug">
                    {pending.options.message}
                  </p>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="lg-btn" onClick={() => finish(false)} autoFocus>
                    {pending.options.cancelLabel ?? "Cancel"}
                  </button>
                  <button type="button" className="lg-btn lg-btn-primary" onClick={() => finish(true)}>
                    {pending.options.confirmLabel ?? "Yes, continue"}
                  </button>
                </div>
              </div>
            )}
          </dialog>
        </ConfirmContext.Provider>
      </NoteLaneContext.Provider>
    </NoteContext.Provider>
  );
}
