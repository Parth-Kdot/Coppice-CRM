"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, STAGES } from "@/lib/stages";
import { CheckIcon, StageGlyph } from "./icons";

// The one-click "Move to" menu on a board slip. A ruled card with the six stages; a click moves the
// company at once (Committed and Declined still ask first, in the board). It opens from the slip's
// stage glyph button or from the m key on a focused slip. Arrow keys move, Enter picks, Escape closes
// and returns focus to the button, Tab and a click outside close it. It is drawn in a portal so a
// scrolling column never clips it.

export function MoveMenu({
  anchor,
  companyName,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  companyName: string;
  current: Stage;
  onPick: (stage: Stage) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // Place the card under the button, right edges together, or above it when there is no room below.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, a.right - w));
      const below = a.bottom + 6;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 6) : below;
      el.style.setProperty("left", `${left}px`);
      el.style.setProperty("top", `${top}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const first = STAGES.findIndex((s) => s !== current);
    items.current[first]?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card.current?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    };
    // A scroll that carries the button away would leave the card hanging in the air. A scroll that
    // only brought the button into view (the menu opened from the keyboard) leaves it where it is.
    const start = anchor.getBoundingClientRect();
    const onScroll = (event: Event) => {
      if (card.current?.contains(event.target as Node)) return;
      const now = anchor.getBoundingClientRect();
      if (Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1) onClose(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, current, onClose]);

  const focusAt = (index: number) => {
    const count = STAGES.length;
    for (let step = 0; step < count; step++) {
      const next = (index + step + count) % count;
      if (STAGES[next] !== current) {
        items.current[next]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.current.findIndex((el) => el === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      for (let i = 1; i <= STAGES.length; i++) {
        const next = (index - i + STAGES.length * 2) % STAGES.length;
        if (STAGES[next] !== current) {
          items.current[next]?.focus();
          break;
        }
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(STAGES.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Tab") {
      onClose(false);
    }
  };

  return createPortal(
    <div ref={card} className="lg-movemenu" role="menu" aria-label={`Move ${companyName} to`} onKeyDown={onKeyDown}>
      <p className="lg-movemenu-head lg-sc" aria-hidden="true">
        Move to
      </p>
      {STAGES.map((stage, i) => {
        const here = stage === current;
        return (
          <button
            key={stage}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            role="menuitem"
            className="lg-movemenu-item"
            aria-current={here ? "true" : undefined}
            aria-disabled={here || undefined}
            tabIndex={-1}
            onClick={() => {
              if (here) return;
              onPick(stage);
            }}
          >
            <StageGlyph stage={stage} size={16} />
            <span>{STAGE_LABELS[stage]}</span>
            {here && (
              <span className="lg-movemenu-here">
                <CheckIcon size={15} />
                <span className="lg-sr">Current stage</span>
              </span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
