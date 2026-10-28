"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatDay } from "@/demo/dates";
import { selectReplyChoice, type ReplyChoice } from "@/demo/selectors";
import { useDemoActions, useDemoState } from "@/demo/store";
import { STAGE_LABELS, isTerminalStage, type Stage } from "@/demo/types";
import { WarningIcon } from "./icons";
import "./ledger.css";
import "./shell.css";
import "./screens.css";
import "./queue.css";
import "./board.css";

// Three small services every Ledger screen shares: margin notes (toasts), a confirmation dialog, and
// the reviewer's race switch (the next Claim loses to a teammate, so the refusal can be seen).

// ----- Margin notes -----

type Note = { id: number; text: string; tone: "ok" | "error" };
type Notify = (text: string, tone?: "ok" | "error") => void;

const NoteContext = createContext<Notify>(() => undefined);
export const useNotify = (): Notify => useContext(NoteContext);

// The workspace shell has a lane for notes in its footer, so a note sits in the page's own margin
// and never lies over the rows. Screens without a footer (sign-in, the workspace list) get a fixed
// lane at the bottom left instead.
const NoteLaneContext = createContext<(el: HTMLElement | null) => void>(() => undefined);
export const useNoteLane = () => useContext(NoteLaneContext);

// ----- Confirm -----

type ConfirmOptions = { message: string; confirmLabel?: string; cancelLabel?: string; title?: string };
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false));
export const useConfirm = (): Confirm => useContext(ConfirmContext);

// ----- Moving a company to another stage -----

// One service for every way of moving a stage (the palette, the board's Move to menu, the company
// page): Committed and Declined ask first, and a move to Replied or later asks which outreach got
// the reply. Resolves to true when the company moved.
// onError takes a refusal ("Sam Lee holds this company until...") when the caller shows it in its own
// margin instead of in the status line.
export type MoveRequest = { ws: string; companyId: string; companyName: string; to: Stage; onError?: (message: string) => void };
type MoveStage = (request: MoveRequest) => Promise<boolean>;

const MoveContext = createContext<MoveStage>(() => Promise.resolve(false));
export const useMoveStage = (): MoveStage => useContext(MoveContext);

// ----- Reviewer race switch -----

type Tools = { raceNext: boolean; setRaceNext: (on: boolean) => void };
const ToolsContext = createContext<Tools>({ raceNext: false, setRaceNext: () => undefined });
export const useLedgerTools = (): Tools => useContext(ToolsContext);

export function LedgerProviders({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [lane, setLane] = useState<HTMLElement | null>(null);
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

  // ----- Move stage service -----
  const actions = useDemoActions();
  const demoState = useDemoState();
  const stateRef = useRef(demoState);
  useEffect(() => {
    stateRef.current = demoState;
  });
  const [asking, setAsking] = useState<{ request: MoveRequest; reply: ReplyChoice; resolve: (moved: boolean) => void } | null>(null);
  const [pick, setPick] = useState("none");
  const replyRef = useRef<HTMLDialogElement>(null);
  const replyId = useId();

  useEffect(() => {
    const dialog = replyRef.current;
    if (asking && dialog && !dialog.open) dialog.showModal();
  }, [asking]);

  const perform = useCallback(
    (request: MoveRequest, replyOutreachId?: string | null): boolean => {
      const result = actions.moveStage(request.ws, request.companyId, request.to, replyOutreachId === undefined ? undefined : { replyOutreachId });
      if (!result.ok) {
        if (request.onError) request.onError(result.error);
        else notify(result.error, "error");
        return false;
      }
      notify(`${request.companyName} moved to ${STAGE_LABELS[request.to]}.`);
      return true;
    },
    [actions, notify],
  );

  const moveStage = useCallback<MoveStage>(
    async (request) => {
      if (isTerminalStage(request.to)) {
        const ok = await confirm({
          message: `Move ${request.companyName} to ${STAGE_LABELS[request.to]}? This closes the pitch and releases any claim.`,
          confirmLabel: `Move to ${STAGE_LABELS[request.to]}`,
        });
        if (!ok) return false;
      }
      const reply = selectReplyChoice(stateRef.current, request.ws, request.companyId, request.to);
      if (reply.needed) {
        return new Promise<boolean>((resolve) => {
          setPick("none");
          setAsking({ request, reply, resolve });
        });
      }
      return perform(request);
    },
    [confirm, perform],
  );

  const finishAsk = (moved: boolean | "submit") => {
    const current = asking;
    if (!current) return;
    setAsking(null);
    replyRef.current?.close();
    if (moved === "submit") current.resolve(perform(current.request, pick === "none" ? null : pick));
    else current.resolve(false);
  };

  const noteList = notes.map((note) => (
    <p key={note.id} className={`lg-note ${note.tone === "error" ? "lg-note-error" : ""}`}>
      {note.text}
    </p>
  ));

  return (
    <NoteContext.Provider value={notify}>
      <NoteLaneContext.Provider value={setLane}>
        <ConfirmContext.Provider value={confirm}>
          <ToolsContext.Provider value={tools}>
            <MoveContext.Provider value={moveStage}>
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
              <dialog
                ref={replyRef}
                className="lg-dialog"
                aria-labelledby={`${replyId}-reply`}
                onCancel={(event) => {
                  event.preventDefault();
                  finishAsk(false);
                }}
              >
                {asking && (
                  <form
                    className="p-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      finishAsk("submit");
                    }}
                  >
                    <fieldset>
                      <legend id={`${replyId}-reply`} className="font-display text-[1.15rem] font-medium leading-snug">
                        Which outreach got the reply?
                      </legend>
                      <p className="lg-hint mt-1">
                        This helps the next board see which messages work. {asking.request.companyName} is moving to {STAGE_LABELS[asking.request.to]}.
                      </p>
                      <div className="lg-reply-list">
                        {asking.reply.options.map((o) => (
                          <label key={o.id} className="lg-reply-opt">
                            <input
                              type="radio"
                              className="lg-check"
                              name={`${replyId}-pick`}
                              value={o.id}
                              checked={pick === o.id}
                              onChange={() => setPick(o.id)}
                            />
                            <span>
                              <strong>
                                {formatDay(o.sentAt)}, {o.channelLabel}
                              </strong>{" "}
                              by {o.senderName}
                              {o.note ? <span className="lg-muted lg-quote">: {o.note.length > 80 ? `${o.note.slice(0, 80)}...` : o.note}</span> : null}
                            </span>
                          </label>
                        ))}
                        <label className="lg-reply-opt">
                          <input
                            type="radio"
                            className="lg-check"
                            name={`${replyId}-pick`}
                            value="none"
                            checked={pick === "none"}
                            onChange={() => setPick("none")}
                          />
                          <span>None of these (the reply was a phone call, for example)</span>
                        </label>
                      </div>
                    </fieldset>
                    <div className="mt-5 flex justify-end gap-2">
                      <button type="button" className="lg-btn" onClick={() => finishAsk(false)} autoFocus>
                        Cancel
                      </button>
                      <button type="submit" className="lg-btn lg-btn-primary">
                        Move to {STAGE_LABELS[asking.request.to]}
                      </button>
                    </div>
                  </form>
                )}
              </dialog>
            </MoveContext.Provider>
          </ToolsContext.Provider>
        </ConfirmContext.Provider>
      </NoteLaneContext.Provider>
    </NoteContext.Provider>
  );
}
