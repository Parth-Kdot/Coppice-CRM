"use client";

import Link from "next/link";
import type { KeyboardEvent, PointerEvent } from "react";
import type { BoardCard } from "@/demo/selectors";
import { demoRoutes } from "@/demo/routes";
import { STAGE_LABELS, type Stage } from "@/demo/types";
import { StageGlyph } from "../icons";
import { ClaimChip } from "./claim-chip";
import { isLongOverdue, overdueText, OverdueMark } from "./overdue";

// A board slip, 64 px tall: the company name on the first line with the stage glyph button that opens
// the Move to menu, and on the second line the overdue marker and the claim control (an outlined
// Claim button, a solid "You" chip, or the holder's initials in a dashed chip). A refusal opens a rust
// note in the slip's own margin. Press and drag the slip to move it, or press m while it has focus.

export function Slip({
  ws,
  card,
  shaking,
  flashing,
  lifted,
  error,
  menuOpen,
  onClaim,
  onDismiss,
  onOpenMenu,
  onPointerDown,
}: {
  ws: string;
  card: BoardCard;
  shaking: boolean;
  flashing: boolean;
  lifted: boolean;
  error: string | undefined;
  menuOpen: boolean;
  onClaim: () => void;
  onDismiss: () => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, id: string, stage: Stage) => void;
}) {
  const c = card.company;
  const stageLabel = STAGE_LABELS[c.stage];

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
      data-slip={c.id}
      data-stage={c.stage}
      data-od={isLongOverdue(card.daysOverdue) ? "long" : undefined}
      data-lifted={lifted ? "" : undefined}
      onPointerDown={(event) => onPointerDown(event, c.id, c.stage)}
      onKeyDown={onKeyDown}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="lg-slip-main">
        <h3 className="lg-slip-name">
          <Link href={demoRoutes.company(ws, c.id)} draggable={false} title={c.name}>
            {c.name}
          </Link>
        </h3>
        <button
          type="button"
          className="lg-slip-move"
          data-move-button
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-keyshortcuts="m"
          aria-label={`Move ${c.name} to another stage. Now ${stageLabel}.`}
          title={`Move to another stage (m). Now ${stageLabel}.`}
          onClick={(event) => onOpenMenu(event.currentTarget)}
        >
          <StageGlyph stage={c.stage} size={16} />
        </button>
      </div>
      <div className="lg-slip-sub">
        <span className="lg-slip-due" title={card.followUp && card.daysOverdue !== null ? overdueText(card.daysOverdue, card.followUp) : undefined}>
          {card.followUp && card.daysOverdue !== null ? (
            <OverdueMark days={card.daysOverdue} dueOn={card.followUp} size={14} />
          ) : (
            <span className="lg-muted lg-slip-none">{c.industry ?? "No follow-up set"}</span>
          )}
        </span>
        {!card.closed && <ClaimChip claim={card.claim} companyName={c.name} onClaim={onClaim} shaking={shaking} compact className="lg-slip-claim" />}
      </div>
      {error && (
        <div className="lg-rownote lg-slip-note" role="alert">
          <span>{error}</span>
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
