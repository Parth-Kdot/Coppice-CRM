"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WarningIcon } from "./icons";
import "./ledger.css";
import "./shell.css";
import "./screens.css";

// Three small services every Ledger screen shares: margin notes (toasts), a confirmation dialog, and
// the reviewer's race switch (the next Claim loses to a teammate, so the refusal can be seen).

// ----- Margin notes -----

type Note = { id: number; text: string; tone: "ok" | "error" };
type Notify = (text: string, tone?: "ok" | "error") => void;

const NoteContext = createContext<Notify>(() => undefined);
export const useNotify = (): Notify => useContext(NoteContext);

// ----- Confirm -----

type ConfirmOptions = { message: string; confirmLabel?: string; cancelLabel?: string; title?: string };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false));
export const useConfirm = (): Confirm => useContext(ConfirmContext);

// ----- Reviewer race switch -----

type Tools = { raceNext: boolean; setRaceNext: (on: boolean) => void };
const ToolsContext = createContext<Tools>({ raceNext: false, setRaceNext: () => undefined });
export const useLedgerTools = (): Tools => useContext(ToolsContext);

export function LedgerProviders({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const nextId = useRef(1);
  const [raceNext, setRaceNext] = useState(false);

  const notify = useCallback<Notify>((text, tone = "ok") => {
    const id = nextId.current++;
    setNotes((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setNotes((current) => current.filter((n) => n.id !== id)), 3500);
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

  const tools = useMemo(() => ({ raceNext, setRaceNext }), [raceNext]);

  return (
    <NoteContext.Provider value={notify}>
      <ConfirmContext.Provider value={confirm}>
        <ToolsContext.Provider value={tools}>
          {children}
          <div className="lg-notes" aria-live="polite" aria-atomic="false">
            {notes.map((note) => (
              <p key={note.id} className={`lg-note ${note.tone === "error" ? "lg-note-error" : ""}`}>
                {note.text}
              </p>
            ))}
          </div>
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
                  <p id="lg-confirm-message" className="font-display text-[1.15rem] font-medium leading-snug">
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
        </ToolsContext.Provider>
      </ConfirmContext.Provider>
    </NoteContext.Provider>
  );
}
