"use client";

import { useActionState, useId, useRef, useState } from "react";
import { markReply } from "@/app/(app)/[workspaceId]/companies/actions";
import { CHANNEL_LABELS } from "@/lib/channels";
import type { ReplyChoice } from "@/lib/companies";
import { day, when } from "@/lib/dates";
import type { ActionResult } from "@/lib/validation";
import { CheckIcon } from "./icons";
import { useNotify } from "./providers";
import { ErrorLine } from "./shared";
import { ShowMore } from "./show-more";
import { focusSoon } from "./focus";
import "./templates.css";

// "Which outreach got the reply?": asked once a company moves into Replied, In conversation or
// Committed from an earlier stage. The person picks the entry that got the answer and template stats
// count it, or skips. A plain dialog over the page: Escape or Skip closes it and nothing is saved.
// The newest 5 entries show (older ones one click away), each with one line of its note (the whole
// note once picked). With a single entry it is picked already and the button says so.

const NEWEST = 5;

type Props = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  choices: ReplyChoice[];
  onDone: () => void;
  // Where focus goes when it closes, if the control that opened it is gone (a board slip that moved
  // to another column is a new element). Without it, focus goes back to whatever had it at open.
  returnFocus?: () => HTMLElement | null;
};

export function ReplyPrompt({ workspaceId, companyId, companyName, choices, onDone, returnFocus }: Props) {
  const id = useId();
  const notify = useNotify();
  const dialog = useRef<HTMLDialogElement | null>(null);
  // What had focus when the prompt opened; it gets focus back, so focus never falls to <body>.
  const opener = useRef<Element | null>(null);
  const finish = () => {
    const before = opener.current;
    onDone();
    focusSoon(() => {
      if (document.querySelector("dialog.lg-replyask[open]")) return null;
      if (before instanceof HTMLElement && before.isConnected) return before;
      return returnFocus?.() ?? null;
    });
  };
  const only = choices.length === 1;
  const [picked, setPicked] = useState<string | null>(only ? choices[0].id : null);
  // A date reads "Nov 21"; the time is added only when two entries share a day.
  const days = choices.map((c) => day(c.sentAt));
  const dateOf = (c: ReplyChoice, i: number) => (days.indexOf(days[i]) !== days.lastIndexOf(days[i]) ? when(c.sentAt) : days[i]);
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
    finish();
  };

  return (
    <dialog
      className="lg-dialog lg-replyask"
      aria-labelledby={`${id}-h`}
      ref={(el) => {
        dialog.current = el;
        if (el && !el.open) {
          opener.current = document.activeElement;
          el.showModal();
        }
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
          {only
            ? `${companyName} answered. Was it this one? Template stats count it.`
            : `${companyName} answered. Pick the entry they replied to, so template stats count it.`}
        </p>
        <fieldset className="lg-replyask-list">
          <legend className="lg-sr">Outreach on {companyName}, newest first</legend>
          <ShowMore initial={NEWEST} label="outreach entries">
            {choices.map((c, i) => (
              <label key={c.id} className="lg-replyopt">
                <input type="radio" name="outreachId" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} className="lg-check" />
                <span className="lg-replyopt-text">
                  <span className="lg-replyopt-when">
                    <span>
                      <time dateTime={c.sentAt.toISOString()}>{dateOf(c, i)}</time>, {CHANNEL_LABELS[c.channel]}
                    </span>
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
          </ShowMore>
        </fieldset>
        {state && !state.ok && <ErrorLine>{state.error}</ErrorLine>}
        <div className="lg-replyask-acts">
          <button type="button" className="lg-btn" onClick={close}>
            Skip
          </button>
          <button type="submit" className="lg-btn lg-btn-primary" disabled={pending || picked === null}>
            {pending ? "Working..." : only ? "Yes, this one got the reply" : "Mark as the reply"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
