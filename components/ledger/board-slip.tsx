"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { claimCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS } from "@/lib/stages";
import { ClaimChip, type ClaimView } from "./claim-chip";
import { StageGlyph, WarningIcon } from "./icons";
import { isLongOverdue, OverdueMark, overdueText } from "./overdue";
import { useNotify } from "./providers";

// A board slip, 64 px tall: the company name on the first line with the stage glyph button that
// opens the Move to menu, and on the second line the overdue marker and the claim control (an
// outlined Claim button, a solid "You" chip, or the holder's initials in a quiet chip). A refusal,
// from the claim or from a move, is written in the slip's own margin. Press and drag the slip to
// move it, or press m while it has focus.

export type BoardCardData = {
  id: string;
  name: string;
  industry: string | null;
  stage: Stage;
  days: number | null;
  dueOn: string | null;
  claim: ClaimView;
  // Committed and Declined cannot be claimed.
  closed: boolean;
};

type Props = {
  workspaceId: string;
  card: BoardCardData;
  flashing: boolean;
  lifted: boolean;
  menuOpen: boolean;
  // A refusal from a move, held by the board.
  moveError: string | undefined;
  onDismissMove: () => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string, stage: Stage) => void;
};

export function Slip({ workspaceId, card, flashing, lifted, menuOpen, moveError, onDismissMove, onOpenMenu, onPointerDown }: Props) {
  const [state, formAction, pending] = useActionState(claimCompany, null);
  const [dismissed, setDismissed] = useState<unknown>(null);
  const notify = useNotify();
  const stageLabel = STAGE_LABELS[card.stage];

  useEffect(() => {
    if (state?.ok) notify(`Claimed ${card.name}.`);
  }, [state, notify, card.name]);

  const claimError = state && !state.ok && state !== dismissed ? state.error : null;
  const error = moveError ?? claimError;

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== "m" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const button = event.currentTarget.querySelector<HTMLButtonElement>("[data-move-button]");
    if (!button) return;
    event.preventDefault();
    onOpenMenu(button);
  };

  return (
    <li
      className={`lg-slipcard lg-rule-row ${flashing ? "lg-settle" : ""}`}
      data-slip={card.id}
      data-stage={card.stage}
      data-od={isLongOverdue(card.days) ? "long" : undefined}
      data-lifted={lifted ? "" : undefined}
      onPointerDown={(event) => onPointerDown(event, card.id, card.stage)}
      onKeyDown={onKeyDown}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="lg-slip-main">
        <h3 className="lg-slip-name">
          <Link href={`/${workspaceId}/companies/${card.id}`} draggable={false} title={card.name}>
            {card.name}
          </Link>
        </h3>
        <button
          type="button"
          className="lg-slip-move"
          data-move-button
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-keyshortcuts="m"
          aria-label={`Move ${card.name} to another stage. Now ${stageLabel}.`}
          title={`Move to another stage (m). Now ${stageLabel}.`}
          onClick={(event) => onOpenMenu(event.currentTarget)}
        >
          <StageGlyph stage={card.stage} size={16} />
        </button>
      </div>
      <div className="lg-slip-sub">
        <span className="lg-slip-due" title={card.dueOn && card.days !== null ? overdueText(card.days, card.dueOn) : undefined}>
          {card.dueOn && card.days !== null ? (
            <OverdueMark days={card.days} dueOn={card.dueOn} size={14} />
          ) : (
            <span className="lg-muted lg-slip-none">{card.industry ?? "No follow-up set"}</span>
          )}
        </span>
        {!card.closed && (
          <form action={formAction} className="lg-slip-claim">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="companyId" value={card.id} />
            <ClaimChip claim={card.claim} companyName={card.name} pending={pending} compact />
          </form>
        )}
      </div>
      {error && (
        <div className="lg-rownote lg-slip-note" role="alert">
          <WarningIcon size={16} />
          <span>{error}</span>
          <button
            type="button"
            className="lg-btn lg-btn-quiet lg-btn-sm"
            onClick={() => {
              if (moveError) onDismissMove();
              else setDismissed(state);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
