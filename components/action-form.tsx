"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/validation";

type Props = {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  successMessage?: string;
  // Asks "are you sure?" first; for removing someone or leaving.
  confirmMessage?: string;
  children?: ReactNode;
};

// Runs a server action and shows its { ok: false, error } message under the form.
export function ActionForm({ action, submitLabel, successMessage, confirmMessage, children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {children}
      <button type="submit" disabled={pending} className="rounded border px-3 py-1 disabled:opacity-50">
        {pending ? "Working..." : submitLabel}
      </button>
      {state && !state.ok && (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.ok && successMessage && <p className="w-full text-sm text-green-700">{successMessage}</p>}
    </form>
  );
}
