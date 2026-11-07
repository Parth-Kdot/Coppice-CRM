"use client";

import { useEffect, useRef, useState } from "react";

// Focus helpers, so focus never falls to <body> after an action removes the control that had it.
//
//   focusSoon(target)        On the next animation frame, focus `target`: a CSS selector, an element, or a
//                            function that returns one. A target that is not focusable on its own (a
//                            heading, a list item) gets tabIndex=-1 first. If the target is not in the
//                            document yet (the server's fresh render is still arriving) it looks again
//                            on each frame for about half a second, then gives up quietly.
//   useFocusAfterCommit()    Returns `schedule(target)`. Call it when an action returns, inside
//                            startTransition(() => schedule(target)) so it commits with the server's
//                            fresh render; the focus moves once that render is committed, or as soon as
//                            the component that scheduled it is unmounted by it (a Claim form replaced
//                            by the log card). OverflowMenu uses it for focusAfter; ActionForm waits on
//                            its own action state the same way.

export type FocusTarget = string | HTMLElement | null | (() => HTMLElement | null);

// About half a second at 60 frames a second.
const MAX_FRAMES = 30;

const NATIVELY_FOCUSABLE = "a[href], button, input, select, textarea, summary, iframe, [contenteditable=''], [contenteditable='true']";

function resolve(target: FocusTarget): HTMLElement | null {
  if (!target) return null;
  if (typeof target === "string") return document.querySelector<HTMLElement>(target);
  if (typeof target === "function") return target();
  return target;
}

export function focusSoon(target: FocusTarget): void {
  if (typeof window === "undefined" || !target) return;
  let frames = 0;
  const attempt = () => {
    const el = resolve(target);
    if (!el || !el.isConnected) {
      if (++frames < MAX_FRAMES) requestAnimationFrame(attempt);
      return;
    }
    if (!el.matches(NATIVELY_FOCUSABLE) && !el.hasAttribute("tabindex")) el.tabIndex = -1;
    el.focus({ preventScroll: false });
    // The element focused was from the render being replaced: look again for its successor.
    requestAnimationFrame(() => {
      if (!el.isConnected && ++frames < MAX_FRAMES) attempt();
    });
  };
  requestAnimationFrame(attempt);
}

export function useFocusAfterCommit(): (target: FocusTarget | undefined) => void {
  const pending = useRef<FocusTarget | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!pending.current) return;
    const target = pending.current;
    pending.current = undefined;
    focusSoon(target);
  }, [tick]);

  // Unmounted by the very render the action caused: the new DOM is already in place.
  useEffect(
    () => () => {
      if (pending.current) focusSoon(pending.current);
    },
    [],
  );

  return (target) => {
    if (!target) return;
    pending.current = target;
    setTick((n) => n + 1);
  };
}
