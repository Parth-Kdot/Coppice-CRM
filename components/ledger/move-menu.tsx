"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, STAGES } from "@/lib/stages";
import { CheckIcon, StageGlyph } from "./icons";
import { popoverPortal, usePopover } from "./popover";

// The "Move to" menu: a ruled card with the six stages; a click moves the company at once (Committed
// and Declined still ask first, in the caller). On the board it opens from a slip's stage glyph
// button or the m key, and also carries the slip's other actions (Claim, Release) below a rule.
// Arrow keys move (skipping the current stage), Home and End go to the first and last item that can
// be picked, Enter picks, Escape closes and returns focus to the button, Tab, focus leaving and a
// click outside close it. Drawn in a portal (usePopover) so a scrolling column never clips it.
//
// disabledReason: the stages can't be picked by this person (an officer, on a company someone else
// holds). The menu then shows that one sentence, as a disabled item that still takes focus so it is
// read out, instead of stage choices the server would refuse.

export type MoveMenuAction = { key: string; label: string; onSelect: () => void };

type Item = { key: string; label: string; stage?: Stage; here?: boolean; reason?: boolean; onSelect?: () => void };

export function MoveMenu({
  anchor,
  companyName,
  current,
  onPick,
  onClose,
  disabledReason,
  actions = [],
}: {
  anchor: HTMLElement;
  companyName: string;
  current: Stage;
  onPick: (stage: Stage) => void;
  onClose: (restoreFocus: boolean) => void;
  disabledReason?: string;
  actions?: MoveMenuAction[];
}) {
  const card = usePopover(anchor, true, { align: "right", onDismiss: () => onClose(false) });
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const list: Item[] = [
    ...(disabledReason
      ? [{ key: "reason", label: disabledReason, reason: true }]
      : STAGES.map((stage) => ({ key: stage, label: STAGE_LABELS[stage], stage, here: stage === current }))),
    ...actions.map((a) => ({ key: a.key, label: a.label, onSelect: a.onSelect })),
  ];
  // Every item takes focus except the current stage, which can't be picked and is only marked.
  const focusable = list.map((item) => !item.here);

  // Focus `from`, or the nearest item that takes focus in the direction of `step`, wrapping.
  const focusFrom = (from: number, step: 1 | -1) => {
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const at = (((from + i * step) % count) + count) % count;
      if (focusable[at]) {
        items.current[at]?.focus();
        return;
      }
    }
  };

  useEffect(() => {
    focusFrom(0, 1);
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFrom(index + 1, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusFrom(index - 1, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusFrom(0, 1);
    } else if (event.key === "End") {
      // Backwards from the last item, so End never wraps round to the first.
      event.preventDefault();
      focusFrom(list.length - 1, -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") {
      // Back to the button first, so the browser's own Tab moves on from there, not from <body>.
      onClose(true);
    }
  };

  const onBlur = () => {
    requestAnimationFrame(() => {
      if (!document.hasFocus()) return;
      const active = document.activeElement;
      if (card.current?.contains(active) || anchor.contains(active)) return;
      onClose(false);
    });
  };

  return popoverPortal(
    <div ref={card} className="lg-movemenu" role="menu" aria-label={`Move ${companyName} to`} onKeyDown={onKeyDown} onBlur={onBlur}>
      {!disabledReason && (
        <p className="lg-movemenu-head lg-tag" aria-hidden="true">
          Move to
        </p>
      )}
      {list.map((item, i) => (
        <button
          key={item.key}
          ref={(el) => {
            items.current[i] = el;
          }}
          type="button"
          role="menuitem"
          className={`lg-movemenu-item${item.onSelect ? " lg-movemenu-act" : ""}${item.reason ? " lg-movemenu-reason" : ""}`}
          aria-current={item.here ? "true" : undefined}
          aria-disabled={item.here || item.reason || undefined}
          tabIndex={-1}
          onClick={() => {
            if (item.here || item.reason) return;
            if (item.stage) onPick(item.stage);
            else item.onSelect?.();
          }}
        >
          {item.stage && <StageGlyph stage={item.stage} size={16} />}
          <span>{item.label}</span>
          {item.here && (
            <span className="lg-movemenu-here">
              <CheckIcon size={15} />
              <span className="lg-sr">Current stage</span>
            </span>
          )}
        </button>
      ))}
    </div>,
    anchor,
  );
}
