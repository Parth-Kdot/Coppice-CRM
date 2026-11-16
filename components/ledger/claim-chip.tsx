"use client";

import { useEffect, useRef } from "react";
import { ClaimIcon } from "./icons";
import { Ribbon } from "./marks";
import { prefersReducedMotion } from "./motion-kit";
import type { ClaimState } from "@/lib/claims";
import "./claims.css";

// The claim control, in three states that never rely on color alone.
//   free:   an outlined "Claim" button (a submit button; the form around it runs the real claim action)
//   yours:  a solid ink chip with the gilt ribbon, "Yours until Nov 11"
//   theirs: a solid quiet chip with the holder's short name, "Priya R."; the full name and when the
//           claim ends are in the tooltip and read out for screen readers
// A claim that has run out (state "expired") reads as free, with the old holder in the tooltip.
// The ribbon drops into the chip once, when a claim becomes yours.

// "Priya Raman" becomes "Priya R."
function shortName(name: string | null): string {
  if (!name) return "Someone";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// "Priya Raman" becomes "PR"
function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// The free chip's tooltip: whose claim ran out, and how long a new claim lasts.
function freeTitle(claim: ClaimView, holder: string, windowDays?: number): string | undefined {
  const lasts = windowDays ? `Claim it for ${windowDays} ${windowDays === 1 ? "day" : "days"}` : undefined;
  if (claim.state !== "expired") return lasts;
  const expired = `${holder}'s claim expired ${claim.until ?? ""}`.trim();
  return lasts ? `${expired}. ${lasts}` : expired;
}

export type ClaimView = {
  state: ClaimState;
  holderName: string | null;
  // The short date the claim runs to ("Nov 7"), or null when nobody holds it.
  until: string | null;
};

type Props = {
  claim: ClaimView;
  companyName: string;
  pending?: boolean;
  // The board slip's size: "Claim", "You" or the holder's initials. The full text stays in the
  // tooltip and for screen readers.
  compact?: boolean;
  className?: string;
  // The workspace's claim window, said in the free chip's tooltip ("Claim it for 14 days"), so no
  // screen has to print it.
  windowDays?: number;
  // data-tour on the Claim button, for the onboarding tour.
  dataTour?: string;
};

export function ClaimChip({ claim, companyName, pending = false, compact = false, className = "", windowDays, dataTour }: Props) {
  const wrap = useRef<HTMLSpanElement>(null);
  const before = useRef(claim.state);
  const kind = claim.state === "mine" ? "mine" : claim.state === "theirs" ? "theirs" : "free";
  const holder = claim.holderName ?? "someone";

  // The ribbon drops from the top edge of the chip, 220 ms, only when the claim has just become yours.
  useEffect(() => {
    const was = before.current;
    before.current = claim.state;
    if (was === claim.state || claim.state !== "mine") return;
    if (prefersReducedMotion()) return;
    wrap.current?.querySelector(".lg-ribbon")?.animate([{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], {
      duration: 220,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
  }, [claim.state]);

  return (
    <span ref={wrap} className={`lg-claimchip ${className}`} data-kind={kind} data-compact={compact || undefined}>
      {kind === "free" ? (
        <button
          type="submit"
          className="lg-chipbody lg-chip-free"
          // Not `disabled`: a disabled button drops focus to <body> mid-claim. A second press while
          // the first is on its way is ignored instead.
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          data-tour={dataTour}
          title={freeTitle(claim, holder, windowDays)}
        >
          <span className="lg-claimword" aria-hidden={compact || undefined}>
            {pending ? "Claiming" : "Claim"}
          </span>
          {compact && <ClaimIcon size={15} className="lg-claimico" />}
          <span className="lg-sr">{compact ? `Claim ${companyName}` : ` ${companyName}`}</span>
        </button>
      ) : kind === "mine" ? (
        <span className="lg-chipbody lg-chip-mine" title={`You hold ${companyName} until ${claim.until}`}>
          <Ribbon size="sm" className="lg-chip-ribbon" />
          {compact ? (
            <>
              <span aria-hidden="true">You</span>
              <span className="lg-sr">Yours until {claim.until}</span>
            </>
          ) : (
            <>Yours until {claim.until}</>
          )}
        </span>
      ) : (
        <span className="lg-chipbody lg-chip-theirs" title={`Held by ${holder} until ${claim.until}`}>
          <span className="lg-sr">
            Held by {holder} until {claim.until}
          </span>
          <span aria-hidden="true">{compact ? initials(claim.holderName) : shortName(claim.holderName)}</span>
        </span>
      )}
    </span>
  );
}
