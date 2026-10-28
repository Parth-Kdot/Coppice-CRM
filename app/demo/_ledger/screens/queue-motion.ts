"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

// Two small motions for the queue, both through the Web Animations API and CSSOM properties, so the
// strict style policy has nothing to object to.
//
//   useFlip:   when the rows are re-ordered, removed or added, every row that stays slides from where
//              it was to where it is now (First, Last, Invert, Play), 220 ms. A logged row leaving the
//              list therefore closes the gap, and a re-sort slides instead of jumping.
//   useGlide:  one moss margin bar that slides to the selected row (transform, 90 ms from the CSS).

export const reducedMotionNow = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Rows carry data-row="<id>" and the container is a positioned element, so offsetTop is the row's
// place inside it: independent of scrolling and of any animation still running.
export function useFlip(container: RefObject<HTMLElement | null>, signature: string) {
  const last = useRef<Map<string, number>>(new Map());
  useIsoLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, number>();
    const rows = root.querySelectorAll<HTMLElement>("[data-row]");
    const animate = !reducedMotionNow() && last.current.size > 0;
    rows.forEach((row) => {
      const id = row.dataset.row as string;
      const top = row.offsetTop;
      next.set(id, top);
      const before = last.current.get(id);
      if (animate && before !== undefined && Math.abs(before - top) > 1 && typeof row.animate === "function") {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
      }
    });
    last.current = next;
  }, [container, signature]);
}

// The bar lives inside the same positioned body as the rows. Its place is written as two custom
// properties, and the CSS turns them into a transform with a 90 ms transition.
export function useGlide(body: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, activeId: string | null, signature: string) {
  useIsoLayoutEffect(() => {
    const root = body.current;
    const el = bar.current;
    if (!root || !el) return;
    const place = () => {
      const row = activeId ? root.querySelector<HTMLElement>(`[data-row="${CSS.escape(activeId)}"]`) : null;
      if (!row) {
        el.setAttribute("data-hidden", "true");
        return;
      }
      const wasHidden = el.hasAttribute("data-hidden");
      el.removeAttribute("data-hidden");
      // The bar covers the row's own line, not a note written under it.
      const line = row.querySelector<HTMLElement>(".lg-qgrid");
      el.style.setProperty("--gy", `${row.offsetTop}px`);
      el.style.setProperty("--gh", `${line ? line.offsetHeight : row.offsetHeight}px`);
      // A bar that was not showing appears where the row is, instead of sliding in from the top.
      if (wasHidden) {
        el.style.setProperty("transition", "none");
        void el.offsetHeight;
        el.style.removeProperty("transition");
      }
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [body, bar, activeId, signature]);
}

// True while the viewport matches a media query. Always false on the server.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
