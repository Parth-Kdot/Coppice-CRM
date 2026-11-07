"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Small motion pieces any Ledger list can share. All of it is CSS in ledger.css (keyframes
// lg-exit-slide, lg-enter-rise and lg-ack-settle, the .lg-exit collapse), driven by data
// attributes, so the strict style policy allows it and the global reduced-motion rule turns it
// into an instant swap. A state change never waits on an animation for long: every end event has
// a timer behind it.

// Slower than the CSS (slide 220 ms, then the collapse 220 ms after 160 ms), so the end event
// normally wins.
export const EXIT_FALLBACK_MS = 800;

// Calls `onDone` once, when `active` turns true and either the CSS signals the end or the timer
// runs out. Returns the handler to pass to onTransitionEnd or onAnimationEnd.
export function useMotionEnd(active: boolean, onDone: () => void, { property, ms = EXIT_FALLBACK_MS }: { property?: string; ms?: number } = {}) {
  const done = useRef(false);
  const latest = useRef(onDone);
  useEffect(() => {
    latest.current = onDone;
  });
  useEffect(() => {
    done.current = false;
    if (!active) return;
    const timer = window.setTimeout(() => {
      if (done.current) return;
      done.current = true;
      latest.current();
    }, ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return (event: React.TransitionEvent | React.AnimationEvent) => {
    // Children animate too (ticks, counts): only this element's own end counts.
    if (!active || done.current || event.target !== event.currentTarget) return;
    if (property && "propertyName" in event && event.propertyName !== property) return;
    done.current = true;
    latest.current();
  };
}

// A block that can leave: it fades and slides out, then its height closes so what is below moves
// up into its place. While leaving it is inert, so a second click can't land on it. `entering`
// gives the opposite on arrival: it rises into place.
export function ExitCollapse({ leaving, entering = false, onLeft, className = "", children }: { leaving: boolean; entering?: boolean; onLeft: () => void; className?: string; children: ReactNode }) {
  const onEnd = useMotionEnd(leaving, onLeft, { property: "grid-template-rows" });
  return (
    <div className={`lg-exit ${className}`} data-leaving={leaving || undefined} data-entering={(entering && !leaving) || undefined} inert={leaving} onTransitionEnd={onEnd}>
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
