"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { focusSoon, useFocusAfterCommit, whenDrawn } from "../focus";
import { completeStamp, removeAway, restore } from "../motion-kit";
import { useNotify } from "../providers";
import type { Action } from "./types";
import "../company.css";
import "../templates.css";

const TICKET = '[data-tour="company-claim"]';

// Claim it / Claim again. On success the new ticket is stamped (a press, a moss ring) and the gilt
// ribbon settles onto its stub; the log card appears under it and its checked channel chip takes
// focus. A refusal (someone was quicker) is a toast naming the winner, the page re-renders with them
// on the ticket, and focus moves to the ticket, never to <body>.
export function ClaimButton({ action, workspaceId, companyId, companyName, label }: { action: Action; workspaceId: string; companyId: string; companyName: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const notify = useNotify();
  const router = useRouter();
  const schedule = useFocusAfterCommit();
  return (
    <button
      type="button"
      className="lg-btn lg-btn-sm lg-btn-primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const form = new FormData();
          form.set("workspaceId", workspaceId);
          form.set("companyId", companyId);
          const result = await action(null, form);
          if (result.ok) {
            notify(`Claimed ${companyName}.`);
            whenDrawn(
              () => document.querySelector<HTMLElement>(`${TICKET}[data-kind="mine"]`),
              (ticket) => void completeStamp(ticket, { mark: ticket.querySelector(".lg-ticket-ribbon") }),
            );
            startTransition(() => focusSoon('#log-outreach input[name="channel"]:checked'));
          } else {
            notify(result.error, "error");
            // The refresh redraws the ticket as a new element (its key is the claim state). Focus moves
            // once that render commits, or when it unmounts this button.
            router.refresh();
            startTransition(() => schedule(TICKET));
          }
        })
      }
    >
      {pending ? "Working..." : label}
    </button>
  );
}

// Release (your own claim) and Force release (an owner, on someone else's). Once confirmed, the
// ticket's body tears off along the perforation and slides away while the server releases it; the
// stub stays for the moment it takes the fresh, free ticket to arrive. A refusal puts the body back.
// Focus goes to the new ticket's Claim button.
export function TicketRelease({
  action,
  workspaceId,
  companyId,
  submitLabel,
  ariaLabel,
  confirmMessage,
  successMessage,
  undo,
}: {
  action: Action;
  workspaceId: string;
  companyId: string;
  submitLabel: string;
  ariaLabel?: string;
  // Asked first; left out for your own release, which "Undo" in the note takes back.
  confirmMessage?: string;
  successMessage: string;
  // Claims it again (the claim action), offered as "Undo" in the success note.
  undo?: Action;
}) {
  const notify = useNotify();
  const [, startTransition] = useTransition();
  const takeBack = undo
    ? () =>
        startTransition(async () => {
          const form = new FormData();
          form.set("workspaceId", workspaceId);
          form.set("companyId", companyId);
          const result = await undo(null, form);
          if (!result.ok) notify(result.error, "error");
          else {
            // The Undo button went with the note: focus the new ticket's button once it is drawn.
            whenDrawn(
              () => document.querySelector<HTMLElement>(`${TICKET}[data-kind="mine"]`),
              (ticket) => {
                const active = document.activeElement;
                if (!active || active === document.body) ticket.querySelector<HTMLElement>("button")?.focus();
                void completeStamp(ticket, { mark: ticket.querySelector(".lg-ticket-ribbon") });
              },
            );
          }
        })
    : undefined;
  const tear = useCallback<Action>(
    async (prev, form) => {
      const ticket = document.querySelector<HTMLElement>(TICKET);
      const body = ticket?.querySelector<HTMLElement>(".lg-ticket-body");
      const leaving = removeAway(body, { direction: "right", distance: 28, collapse: false, focus: ticket });
      try {
        const result = await action(prev, form);
        if (!result.ok) restore(body);
        else await leaving;
        return result;
      } catch (error) {
        restore(body);
        throw error;
      }
    },
    [action],
  );
  return (
    <ActionForm
      action={tear}
      submitLabel={submitLabel}
      small
      submitAriaLabel={ariaLabel}
      confirmMessage={confirmMessage}
      successMessage={successMessage}
      successUndo={takeBack}
      focusAfter={`${TICKET} button`}
      className="lg-ticket-form"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="companyId" value={companyId} />
    </ActionForm>
  );
}
