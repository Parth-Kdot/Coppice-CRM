"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useActionState, useEffect, useState, type PointerEvent } from "react";
import { claimCompany } from "@/app/(app)/[workspaceId]/companies/actions";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS } from "@/lib/stages";
import { ClaimChip, type ClaimView } from "./claim-chip";
import { HourglassIcon, StageGlyph, WarningIcon } from "./icons";
import { isLongOverdue, overdueLevel, overdueText, shortDue } from "./overdue";
import { useNotify } from "./providers";

// A board slip, 64 px tall, and the whole of it is the link to the company (a stretched link; the
// two buttons sit above it). First line: the name and the stage glyph button, which opens the slip's
// menu (Move to, Claim, Release). Second line: the compact due mark ("9d late", the full words in
// the title and for screen readers), or the industry in italics when no follow-up is set, and who
// holds it ("You" or initials). A free slip shows Claim
// only while hovered or focused; on a touch screen Claim lives in the menu. A refusal, from a claim
// or a move, is written in the slip's own margin.
//
// Keyboard: the board gives each column one tab stop (a roving tabindex on the slip links, managed
// in board-view.tsx); the two buttons are out of the tab order and reached with m (menu) and c
// (claim). Memoized: during a drag nothing re-renders, and a move or a claim re-renders only the
// slips whose props changed.

export type BoardCardData = {
  id: string;
  name: string;
  // Shown in the second line when no follow-up is set, so a fresh slip still says what it is.
  industry: string | null;
  stage: Stage;
  days: number | null;
  dueOn: string | null;
  claim: ClaimView;
  // Committed and Declined cannot be claimed.
  closed: boolean;
  // Shown at the top of its column although it sorts further down: it was just moved here.
  justMoved?: boolean;
};

type Props = {
  workspaceId: string;
  card: BoardCardData;
  flashing: boolean;
  menuOpen: boolean;
  // Someone else holds it and the viewer is an officer: no drag, and the menu says why.
  locked: boolean;
  // A refusal from a move or a claim made from the menu, held by the board.
  error: string | undefined;
  onDismissError: (id: string) => void;
  onOpenMenu: (id: string, button: HTMLButtonElement) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string, stage: Stage) => void;
};

export const Slip = memo(function Slip({ workspaceId, card, flashing, menuOpen, locked, error: boardError, onDismissError, onOpenMenu, onPointerDown }: Props) {
  const [state, formAction, pending] = useActionState(claimCompany, null);
  const [dismissed, setDismissed] = useState<unknown>(null);
  const notify = useNotify();
  const stageLabel = STAGE_LABELS[card.stage];
  const free = !card.closed && (card.claim.state === "free" || card.claim.state === "expired");

  const router = useRouter();
  useEffect(() => {
    if (state?.ok) notify(`Claimed ${card.name}.`);
    // Refused: someone else got there first, so the slip is out of date. Show who holds it now.
    else if (state && !state.ok) router.refresh();
  }, [state, notify, card.name, router]);

  const claimError = state && !state.ok && state !== dismissed ? state.error : null;
  const error = boardError ?? claimError;
  const due =
    card.dueOn !== null && card.days !== null ? { level: overdueLevel(card.days), full: overdueText(card.days, card.dueOn), short: shortDue(card.days) } : null;

  return (
    <li
      className={`lg-slipcard lg-rule-row ${flashing ? "lg-settle" : ""}`}
      data-slip={card.id}
      data-stage={card.stage}
      data-od={isLongOverdue(card.days) ? "long" : undefined}
      data-locked={locked || undefined}
      onPointerDown={(event) => onPointerDown(event, card.id, card.stage)}
      onDragStart={(event) => event.preventDefault()}
    >
      <Link href={`/${workspaceId}/companies/${card.id}`} draggable={false} className="lg-slip-link" data-slip-link title={card.name}>
        <span className="lg-slip-name">{card.name}</span>
        <span className="lg-slip-due">
          {due && (
            <span className="lg-od" data-level={due.level} title={due.full}>
              <HourglassIcon
                sand={due.level === "upcoming" ? "empty" : due.level === "long" ? "drained" : due.level === "overdue" ? "low" : "half"}
                size={14}
              />
              <span aria-hidden="true">{due.short}</span>
              <span className="lg-sr">, {due.full}</span>
            </span>
          )}
          {!due && card.industry && (
            <span className="lg-slip-ind" title={card.industry}>
              {card.industry}
            </span>
          )}
          {card.justMoved && (
            <span className="lg-slip-moved" title="Just moved here. It shows at the top until the board reloads.">
              Moved<span className="lg-sr"> just now</span>
            </span>
          )}
        </span>
      </Link>
      <button
        type="button"
        className="lg-slip-move"
        data-move-button
        data-tour="slip-move"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-keyshortcuts="m"
        aria-label={`Actions for ${card.name}: move to another stage${free ? " or claim" : ""}. Now ${stageLabel}.`}
        title={`Move or claim (m). Now ${stageLabel}.`}
        onClick={(event) => onOpenMenu(card.id, event.currentTarget)}
      >
        <StageGlyph stage={card.stage} size={16} />
      </button>
      <span className="lg-slip-claim">
        {free ? (
          <form action={formAction} data-claim-form>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="companyId" value={card.id} />
            <span className="lg-claimchip" data-kind="free" data-compact="">
              <button
                type="submit"
                className="lg-chipbody lg-chip-free lg-slip-claimbtn"
                data-tour="slip-claim"
                tabIndex={-1}
                aria-keyshortcuts="c"
                disabled={pending}
                title={card.claim.state === "expired" ? `${card.claim.holderName ?? "Someone"}'s claim expired ${card.claim.until ?? ""}`.trim() : "Claim (c)"}
              >
                <span aria-hidden="true">{pending ? "Claiming" : "Claim"}</span>
                <span className="lg-sr">Claim {card.name}</span>
              </button>
            </span>
          </form>
        ) : (
          !card.closed && card.claim.state !== "free" && <ClaimChip claim={card.claim} companyName={card.name} compact />
        )}
      </span>
      {error && (
        <div className="lg-rownote lg-slip-note" role="alert">
          <WarningIcon size={16} />
          <span>{error}</span>
          <button
            type="button"
            className="lg-btn lg-btn-quiet lg-btn-sm"
            onClick={() => {
              if (boardError) onDismissError(card.id);
              else setDismissed(state);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
});
