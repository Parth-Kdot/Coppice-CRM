"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ErrorLine } from "@/components/ledger/shared";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import { focusSoon, type FocusTarget } from "@/components/ledger/focus";
import { Tick } from "@/components/ledger/marks";
import { completeStamp, removeAway } from "@/components/ledger/motion-kit";
import type { ActionResult } from "@/lib/validation";

// Runs a server action from a form with one submit button. A refusal is written under the form,
// where the person is looking; a success is written as a margin note.
//
// Optional extras (all off by default, so a form without them behaves as it always has):
//   focusAfter       a selector, or a function returning an element, focused once the action
//                    succeeds and the new render is in place (focusSoon), so focus never falls to
//                    <body> when the form itself disappears.
//   submitAriaLabel  the button's accessible name when its text alone is ambiguous ("Remove Priya").
//   refreshOnError   router.refresh() after a refusal, for stale-state refusals ("already held").
//   submitClassName  extra classes on the submit button, after the lg-btn ones.
//   submitDataTour   data-tour on the submit button, for the onboarding tour.
//   savedNote        write the success message beside the button (a settings Save) instead of as a
//                    margin note, with a tick, stamped by the motion kit when it lands; it clears
//                    as soon as the form is edited again.
//   successUndo      offered as "Undo" in the success note, for a change that is easy to take
//                    back (releasing your own claim), so it needs no "are you sure?" first.
//   leaveRow         the form removes the list row it sits in (Disconnect, Cancel an invitation):
//                    on success that <li> slides away and its space closes (the motion kit's
//                    removeAway) before the server's fresh list is drawn, and focus moves to the
//                    next row's button (else the one before, else focusAfter).
//
// ActionFormPending / useActionFormPending(): children read whether the action is in flight, so a
// keyboard shortcut (log-form's Ctrl+Enter) can refuse to requestSubmit() while it is.

export const ActionFormPending = createContext<boolean>(false);
export function useActionFormPending(): boolean {
  return useContext(ActionFormPending);
}

type Props = {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  successMessage?: string;
  // Asks "are you sure?" first, in the page's own dialog; for removing someone or leaving.
  confirmMessage?: string;
  // The main button of its page: a moss fill.
  primary?: boolean;
  // A smaller button, for rows of controls inside a list.
  small?: boolean;
  // Layout of the form's row; the default wraps the button and any message under the fields.
  className?: string;
  // Runs after the action succeeds, for clearing state React's own form reset doesn't reach. If it
  // returns a promise (a row leaving with the motion kit's removeAway), the server's fresh render
  // waits for it, so the row isn't pulled out from under its own exit.
  onSuccess?: () => void | Promise<void>;
  focusAfter?: string | (() => HTMLElement | null);
  submitAriaLabel?: string;
  refreshOnError?: boolean;
  submitClassName?: string;
  submitDataTour?: string;
  savedNote?: boolean;
  leaveRow?: boolean;
  successUndo?: () => void;
  children?: ReactNode;
};

// The row after (else before) `li`, its first button: where focus goes when `li` leaves.
export function nextRowControl(li: Element | null | undefined): HTMLElement | null {
  const sibling = li?.nextElementSibling ?? li?.previousElementSibling;
  return sibling?.querySelector<HTMLElement>("button:not([disabled]), a[href]") ?? null;
}

export function ActionForm({
  action,
  submitLabel,
  successMessage,
  confirmMessage,
  primary = false,
  small = false,
  className = "flex flex-wrap items-center gap-2",
  onSuccess,
  focusAfter,
  submitAriaLabel,
  refreshOnError = false,
  submitClassName,
  submitDataTour,
  savedNote = false,
  leaveRow = false,
  successUndo,
  children,
}: Props) {
  const notify = useNotify();
  const router = useRouter();
  // Read when the action returns, so the latest props are used even if the form re-rendered meanwhile.
  const latest = useRef({ focusAfter, refreshOnError, successUndo });
  useEffect(() => {
    latest.current = { focusAfter, refreshOnError, successUndo };
  });
  // focusAfter waits for the render that carries the result (and the server's fresh page), or for
  // this form's unmount when that render removes it.
  const focusNext = useRef<FocusTarget>(null);
  // The inline "Saved" note belongs to this success: shown until the form is edited or sent again.
  const [savedFor, setSavedFor] = useState<ActionResult | null>(null);
  // The margin note is written when the action returns, not from an effect, so it still appears
  // when the form that sent it is gone by then (a fact that moved to the other list, a deleted row).
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, data: FormData) => {
    const result = await action(prev, data);
    const undo = latest.current.successUndo;
    if (result.ok && successMessage && !savedNote) notify(successMessage, "ok", undo ? { action: { label: "Undo", onSelect: undo } } : undefined);
    if (savedNote) setSavedFor(result.ok ? result : null);
    if (result.ok) await onSuccess?.();
    let rowNext: HTMLElement | null = null;
    if (result.ok && leaveRow) {
      const li = form.current?.closest("li");
      rowNext = nextRowControl(li);
      await removeAway(li, { focus: rowNext });
    }
    if (result.ok && (rowNext || latest.current.focusAfter)) focusNext.current = rowNext ?? latest.current.focusAfter ?? null;
    if (!result.ok && latest.current.refreshOnError) router.refresh();
    return result;
  }, null);
  useEffect(() => {
    if (!focusNext.current) return;
    focusSoon(focusNext.current);
    focusNext.current = null;
  }, [state]);
  useEffect(
    () => () => {
      if (focusNext.current) focusSoon(focusNext.current);
    },
    [],
  );
  const savedRef = useRef<HTMLSpanElement>(null);
  const showSaved = savedNote && !!successMessage && savedFor !== null && savedFor === state;
  useEffect(() => {
    if (!showSaved) return;
    void completeStamp(savedRef.current, { mark: savedRef.current?.querySelector("svg") });
  }, [showSaved, state]);
  const confirm = useConfirm();
  const form = useRef<HTMLFormElement>(null);
  // Set once the person has said yes, so the submit that follows goes straight through.
  const confirmed = useRef(false);

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(e) => {
        if (!confirmMessage) return;
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        void confirm({ message: confirmMessage, confirmLabel: submitLabel }).then((ok) => {
          if (!ok) return;
          confirmed.current = true;
          form.current?.requestSubmit(submitter);
        });
      }}
      onInput={showSaved ? () => setSavedFor(null) : undefined}
      className={className}
    >
      <ActionFormPending value={pending}>{children}</ActionFormPending>
      <button
        type="submit"
        disabled={pending}
        aria-label={submitAriaLabel}
        data-tour={submitDataTour}
        className={`lg-btn ${small ? "lg-btn-sm" : ""} ${primary ? "lg-btn-primary" : ""}${submitClassName ? ` ${submitClassName}` : ""}`}
      >
        {pending ? "Working..." : submitLabel}
      </button>
      {savedNote && (
        // Always in the page, so the note is announced when it is written into it.
        <span className="lg-saved-slot" role="status">
          {showSaved && !pending && (
            <span className="lg-saved" ref={savedRef}>
              <Tick size={16} auto={false} className="lg-tick-draw" />
              {successMessage}
            </span>
          )}
        </span>
      )}
      {state && !state.ok && (
        <div className="w-full">
          <ErrorLine>{state.error}</ErrorLine>
        </div>
      )}
    </form>
  );
}
