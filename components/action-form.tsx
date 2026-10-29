"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { useConfirm, useNotify } from "@/components/ledger/providers";
import type { ActionResult } from "@/lib/validation";

type Props = {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  successMessage?: string;
  // Asks "are you sure?" first, in the page's own dialog; for removing someone or leaving.
  confirmMessage?: string;
  // The main button of its page: a moss fill.
  primary?: boolean;
  // Layout of the form's row; the default wraps the button and any message under the fields.
  className?: string;
  children?: ReactNode;
};

// Runs a server action. A refusal is written under the form, where the person is looking; a
// success is written as a margin note.
export function ActionForm({ action, submitLabel, successMessage, confirmMessage, primary = false, className = "flex flex-wrap items-center gap-2", children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const notify = useNotify();
  const confirm = useConfirm();
  const form = useRef<HTMLFormElement>(null);
  // Set once the person has said yes, so the submit that follows goes straight through.
  const confirmed = useRef(false);

  useEffect(() => {
    if (state?.ok && successMessage) notify(successMessage);
  }, [state, successMessage, notify]);

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
      {children}
      <button type="submit" disabled={pending} className={`lg-btn ${primary ? "lg-btn-primary" : ""}`}>
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
