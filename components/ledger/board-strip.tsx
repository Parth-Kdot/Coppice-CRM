"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS } from "@/lib/stages";
import { StageGlyph } from "./icons";
import { prefersReducedMotion } from "./motion-kit";

export const GROUPS: readonly (readonly Stage[])[] = [["NOT_CONTACTED"], ["CONTACTED"], ["REPLIED"], ["IN_CONVERSATION"], ["COMMITTED", "DECLINED"]];

// A column head prints the stage's own name (the same one the company page, the Move to menu and
// search use); in a narrow column it wraps onto two lines instead of being shortened.
const groupLabel = (group: readonly Stage[]) => (group.length > 1 ? "Closed" : STAGE_LABELS[group[0]]);

// The phone's stage strip: one button per column (glyph, short name, count), sticky above the
// columns. Pressing one scrolls the board to that column; the column in view is marked. Hidden on
// wider screens, where every column shows at once.
export function BoardStrip({ scroller, counts }: { scroller: RefObject<HTMLDivElement | null>; counts: number[] }) {
  const [inView, setInView] = useState(0);

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const cols = [...root.querySelectorAll<HTMLElement>(":scope > .lg-bcol")];
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
        let best = 0;
        cols.forEach((col, i) => {
          if ((ratios.get(col) ?? 0) > (ratios.get(cols[best]) ?? 0)) best = i;
        });
        setInView(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    cols.forEach((col) => observer.observe(col));
    return () => observer.disconnect();
  }, [scroller]);

  const jump = (index: number) => {
    const root = scroller.current;
    const col = root?.querySelectorAll<HTMLElement>(":scope > .lg-bcol")[index];
    if (!root || !col) return;
    root.scrollTo({ left: col.offsetLeft, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setInView(index);
  };

  return (
    <div className="lg-bstrip" role="group" aria-label="Jump to a stage" data-tour="board-strip">
      {GROUPS.map((group, i) => (
        <button
          key={group.join("-")}
          type="button"
          className="lg-bstrip-btn"
          data-strip-stages={group.join(" ")}
          aria-current={inView === i ? "true" : undefined}
          onClick={() => jump(i)}
        >
          <StageGlyph stage={group[0]} size={15} />
          <span>{groupLabel(group)}</span>
          <span className="lg-bstrip-n">{counts[i].toLocaleString("en-US")}</span>
        </button>
      ))}
    </div>
  );
}
