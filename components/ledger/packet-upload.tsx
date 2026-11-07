"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { focusSoon } from "@/components/ledger/focus";
import { Tick } from "@/components/ledger/marks";
import { useNotify } from "@/components/ledger/providers";
import { ErrorLine } from "@/components/ledger/shared";
import { pdfFileProblem } from "@/lib/ai/pdf-limits";
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
// its facts, which usually takes under a minute, so the button and a written line say that it is working.
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
  // A file the server would refuse (not a PDF, over 3.5 MB) is refused here, before it is sent.
  const [chosen, setChosen] = useState<{ name: string; after: typeof state; problem: string | null } | null>(null);
  const current = chosen && chosen.after === state ? chosen : null;
  const name = current?.name ?? null;
  const problem = current?.problem ?? null;
  // Once the server answers, the input lets go of the file, so picking the same file again (fixed
  // and re-exported under the same name) fires a change and is read again.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state && input.current) input.current.value = "";
  }, [state]);
  // The button is disabled while the packet is read, so the browser drops focus to the page; when
  // the answer comes, focus goes to what it says.
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state && document.activeElement === document.body) focusSoon(() => result.current?.querySelector<HTMLElement>("p") ?? null);
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="lg-filerow">
        <input
          ref={input}
          id={`${id}-file`}
          name="file"
          autoComplete="off"
          type="file"
          accept="application/pdf,.pdf"
          required
          disabled={pending}
          className="lg-file"
          aria-label="Sponsorship packet PDF"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setChosen(file ? { name: file.name, after: state, problem: pdfFileProblem(file) } : null);
          }}
        />
        <label htmlFor={`${id}-file`} className="lg-btn">
          {name ? "Choose another PDF" : "Choose the packet PDF"}
        </label>
        <span className="lg-filename lg-muted" aria-live="polite">
          {name ?? "No file chosen"}
        </span>
        <button type="submit" className="lg-btn lg-btn-primary" disabled={pending || !name || problem !== null}>
          {pending ? "Working..." : "Upload and read"}
        </button>
      </div>
      {pending && <Quill label="Working... reading the packet. This usually takes under a minute." />}
      <div ref={result}>
        {state?.ok && !pending && (
          <p className="lg-ok mt-3" role="status">
            <Tick size={18} />
            Done. Check the facts below.
          </p>
        )}
        {problem && !pending && <ErrorLine>{problem}</ErrorLine>}
        {state && !state.ok && !pending && !problem && <ErrorLine>{state.error}</ErrorLine>}
      </div>
    </form>
  );
}
