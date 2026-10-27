"use client";

import { useEffect, type RefObject } from "react";
import { REDUCED_MOTION } from "./motion";

// A light reveal for static blocks: elements with .ld-reveal fade up 8 px once they scroll into view.
// The hidden state only applies after this runs (data-js on the root), so without script or with
// reduced motion everything is simply there.
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia(REDUCED_MOTION).matches) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>(".ld-reveal"));
    if (targets.length === 0 || !("IntersectionObserver" in window)) return;
    el.dataset.js = "on";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => {
      io.disconnect();
      delete el.dataset.js;
    };
  }, [root]);
}
