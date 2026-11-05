"use client";

import { useActionState, useId, useState } from "react";
import { Tick } from "@/components/ledger/marks";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import type { ActionResult } from "@/lib/validation";
import "./pages.css";

// A quill line that writes itself while the packet is being read.
function Quill({ label }: { label: string }) {
  return (
    <div className="lg-quill-wait lg-uploadwait" role="status">
      <svg viewBox="0 0 240 28" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth={1.600} strokeLinecap="round" aria-hidden="true">
        <path pathLength={1} d="M2 15 C14 3 26 3 38 15 S62 27 74 15 S98 3 110 15 S134 27 146 15 S170 3 182 15 S206 27 218 15 S232 6 238 12" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

// The packet upload: pick a PDF, then "Upload and read". The server reads the PDF and asks the AI for
// its facts, which can take up to a minute, so the button and a written line say that it is working.
export function PacketUpload({
  workspaceId,
  action,
}: {
  workspaceId: string;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const id = useId();
  const notify = useNotify();
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const result = await action(prev, form);
    if (result.ok) notify("Packet read. Check the facts below.");
    return result;
  }, null);
  // The chosen name belongs to the result it was chosen before: once the server answers, it clears.
  const [chosen, setChosen] = useState<{ name: string; after: typeof state } | null>(null);
  const name = chosen && chosen.after === state ? chosen.name : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="lg-filerow">
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          disabled={pending}
          className="lg-file"
          aria-label="Sponsorship packet PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setChosen(file ? { name: file.name, after: state } : null);
          }}
        />
        <label htmlFor={`${id}-file`} className="lg-btn">
          {name ? "Choose another PDF" : "Choose the packet PDF"}
        </label>
        <span className="lg-filename lg-muted" aria-live="polite">
          {name ?? "No file chosen"}
        </span>
        <button type="submit" className="lg-btn lg-btn-primary" disabled={pending || !name}>
          {pending ? "Working..." : "Upload and read"}
        </button>
      </div>
      {pending && <Quill label="Working... reading the packet. This takes up to a minute." />}
      {state?.ok && !pending && (
        <p className="lg-ok mt-3" role="status">
          <Tick size={18} />
          Done. Check the facts below.
        </p>
      )}
      {state && !state.ok && !pending && <ErrorLine>{state.error}</ErrorLine>}
    </form>
  );
}
