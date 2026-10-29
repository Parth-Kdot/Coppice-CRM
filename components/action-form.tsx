"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { ErrorLine } from "@/components/ledger/shared";
import { useNotify } from "@/components/ledger/providers";
import type { ActionResult } from "@/lib/validation";

type Props = {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  successMessage?: string;
  // Asks "are you sure?" first; for removing someone or leaving.
  confirmMessage?: string;
  // The main button of its page: a moss fill.
  primary?: boolean;
  children?: ReactNode;
};

// Runs a server action. A refusal is written under the form, where the person is looking; a
// success is written as a margin note.
export function ActionForm({ action, submitLabel, successMessage, confirmMessage, primary = false, children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const notify = useNotify();

  useEffect(() => {
    if (state?.ok && successMessage) notify(successMessage);
  }, [state, successMessage, notify]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
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
