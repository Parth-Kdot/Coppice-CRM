"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { removeAway } from "./motion-kit";

// Small motion pieces any Ledger list can share. Leaving runs on the motion kit
// (components/ledger/motion-kit.ts: removeAway); arriving and the "already set" settle are CSS in
// ledger.css (keyframes lg-enter-rise and lg-ack-settle), driven by data attributes. Both keep to
// the strict style policy and to reduced motion (the kit skips the move, the global CSS rule turns
// the keyframes off). A state change never waits on an animation for long: every move resolves on
// a timer even if no frame runs.

// A block that can leave: it slides and fades out, then its height closes so what is below moves
// up into its place, and then `onLeft` runs (the caller takes it out of state). While leaving it is
// inert, so a second click can't land on it. `entering` gives the opposite on arrival: it rises
// into place.
export function ExitCollapse({ leaving, entering = false, onLeft, className = "", children }: { leaving: boolean; entering?: boolean; onLeft: () => void; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onLeft);
  useEffect(() => {
    latest.current = onLeft;
  });
  useEffect(() => {
    if (!leaving) return;
    let live = true;
    // A second run (a development double effect) gets the same promise back: it is already leaving.
    void removeAway(box.current).then(() => {
      if (live) latest.current();
    });
    return () => {
      live = false;
    };
  }, [leaving]);
  return (
    <div ref={box} className={`lg-exit ${className}`} data-entering={(entering && !leaving) || undefined} inert={leaving}>
      <div className="lg-exit-inner">{children}</div>
    </div>
  );
}

// Plays the "already set" settle on an element again, even if it is still playing. The attribute
// is styled in ledger.css and removed by a timer just after the animation.
const ackTimers = new WeakMap<HTMLElement, number>();
export function replayAck(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  window.clearTimeout(ackTimers.get(el));
  el.removeAttribute("data-ack");
  void el.offsetWidth; // restart the animation
  el.setAttribute("data-ack", "");
  ackTimers.set(
    el,
    window.setTimeout(() => el.removeAttribute("data-ack"), 600),
  );
}

// Whether the person asked for reduced motion, for the few places that scroll from script.
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
