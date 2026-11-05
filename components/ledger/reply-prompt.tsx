"use client";

import { useActionState, useId, useRef, useState } from "react";
import { markReply } from "@/app/(app)/[workspaceId]/companies/actions";
import { CHANNEL_LABELS } from "@/lib/channels";
import type { ReplyChoice } from "@/lib/companies";
import { when } from "@/lib/dates";
import type { ActionResult } from "@/lib/validation";
import { CheckIcon } from "./icons";
import { useNotify } from "./providers";
import { ErrorLine } from "./shared";
import "./templates.css";

// "Which outreach got the reply?": asked once a company moves into Replied, In conversation or
// Committed from an earlier stage. The person picks the entry that got the answer and template stats
// count it, or skips. A plain dialog over the page: Escape or Skip closes it and nothing is saved.

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  choices: ReplyChoice[];
  onDone: () => void;
};

export function ReplyPrompt({ workspaceId, companyId, companyName, choices, onDone }: Props) {
  const id = useId();
  const notify = useNotify();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [state, action, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const result = await markReply(prev, form);
    if (result.ok) {
      notify("Marked as the reply.");
      dialog.current?.close();
      onDone();
    }
    return result;
  }, null);

  const close = () => {
    dialog.current?.close();
    onDone();
  };

  return (
    <dialog
      className="lg-dialog lg-replyask"
      aria-labelledby={`${id}-h`}
      ref={(el) => {
        dialog.current = el;
        if (el && !el.open) el.showModal();
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form action={action} className="lg-replyask-body">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="companyId" value={companyId} />
        <h2 id={`${id}-h`} className="lg-h3">
          Which outreach got the reply?
        </h2>
        <p className="lg-hint">
          {companyName} answered. Pick the entry they replied to, so template stats count it. You can skip this.
        </p>
        <fieldset className="lg-replyask-list">
          <legend className="lg-sr">Outreach on {companyName}, newest first</legend>
          {choices.map((c) => (
            <label key={c.id} className="lg-replyopt">
              <input type="radio" name="outreachId" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} className="lg-check" />
              <span className="lg-replyopt-text">
                <span className="lg-replyopt-when">
                  <time dateTime={c.sentAt.toISOString()}>{when(c.sentAt)}</time>, {CHANNEL_LABELS[c.channel]}
                  {c.gotReply && (
                    <span className="lg-badge lg-replied">
                      <CheckIcon size={13} />
                      Marked as a reply
                    </span>
                  )}
                </span>
                <span className="lg-replyopt-meta">
                  {c.senderName}
                  {c.templateName ? `, template: ${c.templateName}` : ""}
                  {c.aiDrafted ? ", from an AI draft" : ""}
                </span>
                {c.note && <span className="lg-replyopt-note">{c.note}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
        <div className="lg-replyask-acts">
          <button type="button" className="lg-btn" onClick={close}>
            Skip
          </button>
          <button type="submit" className="lg-btn lg-btn-primary" disabled={pending || picked === null}>
            {pending ? "Working..." : "Mark as the reply"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
