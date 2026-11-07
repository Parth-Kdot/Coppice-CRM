"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ErrorLine } from "@/components/ledger/shared";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import { focusSoon, type FocusTarget } from "@/components/ledger/focus";
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
  // Runs after the action succeeds, for clearing state React's own form reset doesn't reach.
  onSuccess?: () => void;
  focusAfter?: string | (() => HTMLElement | null);
  submitAriaLabel?: string;
  refreshOnError?: boolean;
  submitClassName?: string;
  submitDataTour?: string;
  children?: ReactNode;
};

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
  children,
}: Props) {
  const notify = useNotify();
  const router = useRouter();
  // Read when the action returns, so the latest props are used even if the form re-rendered meanwhile.
  const latest = useRef({ focusAfter, refreshOnError });
  useEffect(() => {
    latest.current = { focusAfter, refreshOnError };
  });
  // focusAfter waits for the render that carries the result (and the server's fresh page), or for
  // this form's unmount when that render removes it.
  const focusNext = useRef<FocusTarget>(null);
  // The margin note is written when the action returns, not from an effect, so it still appears
  // when the form that sent it is gone by then (a fact that moved to the other list, a deleted row).
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, data: FormData) => {
    const result = await action(prev, data);
    if (result.ok && successMessage) notify(successMessage);
    if (result.ok) onSuccess?.();
    if (result.ok && latest.current.focusAfter) focusNext.current = latest.current.focusAfter;
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
      {state && !state.ok && (
        <div className="w-full">
          <ErrorLine>{state.error}</ErrorLine>
        </div>
      )}
    </form>
  );
}
