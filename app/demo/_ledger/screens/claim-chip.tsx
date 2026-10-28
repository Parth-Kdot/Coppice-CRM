"use client";

import { useLayoutEffect, useRef } from "react";
import { formatDay } from "@/demo/dates";
import type { ClaimView } from "@/demo/selectors";
import { Ribbon } from "../marks";

// The claim control, in three states that never rely on color. All three are drawn in ink.
//   free:   an outlined "Claim" button
//   yours:  a solid ink chip with paper text, "Yours until Nov 11", with the gilt ribbon bookmark
//   theirs: a dashed chip, "Priya R. until Oct 31", full name in the tooltip and for screen readers
// When a free chip becomes yours, the box morphs to its new width in 180 ms (a FLIP: the old width is
// remembered, the new one measured, and the width animated between them), and the ribbon drops into
// the chip (220 ms). The refusal shake is the same 4 px shake the buttons use.

// "Priya Raghunathan" becomes "Priya R."
export function shortName(name: string | null): string {
  if (!name) return "Someone";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ClaimChip({
  claim,
  companyName,
  onClaim,
  shaking = false,
  dropping = false,
  className = "",
}: {
  claim: ClaimView;
  companyName: string;
  onClaim: () => void;
  shaking?: boolean;
  dropping?: boolean;
  className?: string;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  const lastWidth = useRef<number | null>(null);
  const lastState = useRef(claim.state);
  const until = claim.expiresAt ? formatDay(claim.expiresAt) : "";
  const kind = claim.state === "mine" ? "mine" : claim.state === "theirs" ? "theirs" : "free";

  // FLIP: First is the width before this render, Last is the width now, Invert and Play are one animate().
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const next = el.getBoundingClientRect().width;
    const before = lastWidth.current;
    const changed = lastState.current !== claim.state;
    lastState.current = claim.state;
    lastWidth.current = next;
    if (!changed || before === null || Math.abs(before - next) < 2 || reducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ width: `${before}px` }, { width: `${next}px` }], { duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  }, [claim.state]);

  // Measure again after text changes that keep the same state (a new expiry date), so the next morph starts from the right width.
  useLayoutEffect(() => {
    if (wrap.current) lastWidth.current = wrap.current.getBoundingClientRect().width;
  });

  const holderFull = claim.holderName ?? "someone";
  return (
    <span ref={wrap} className={`lg-claimchip ${className}`} data-kind={kind}>
      {kind === "free" ? (
        <button
          type="button"
          className={`lg-chipbody lg-chip-free ${shaking ? "lg-btn-shake" : ""}`}
          onClick={onClaim}
          title={claim.state === "expired" ? `${holderFull}'s claim expired ${until}` : undefined}
        >
          Claim
          <span className="lg-sr"> {companyName}</span>
        </button>
      ) : kind === "mine" ? (
        <span className="lg-chipbody lg-chip-mine" title={`You hold ${companyName} until ${until}`}>
          <Ribbon size="sm" drop={dropping} className="lg-chip-ribbon" />
          Yours until {until}
        </span>
      ) : (
        <span className="lg-chipbody lg-chip-theirs" title={`Held by ${holderFull} until ${until}`}>
          <span className="lg-sr">
            Held by {holderFull} until {until}
          </span>
          <span aria-hidden="true">
            {shortName(claim.holderName)} until {until}
          </span>
        </span>
      )}
    </span>
  );
}
