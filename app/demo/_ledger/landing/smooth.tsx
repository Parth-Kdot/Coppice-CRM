"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { MOTION_OK, setupGsap } from "./motion";

// Lenis smooth scrolling, on the landing only, wired to GSAP's ticker so ScrollTrigger and Lenis
// agree on the scroll position.
//
// When it runs:
//   - Only with no reduced-motion preference. If the preference changes while the page is open,
//     Lenis is created or destroyed on the spot.
//   - Never on touch-only devices (no hover, coarse pointer). Those keep the browser's native
//     scrolling and momentum, and syncTouch stays off as well.
//
// What keeps working: Lenis only eases the wheel, so the keyboard (space, page up and down, home,
// end, arrows) and the scrollbar scroll natively. In-page anchor links glide to their section (Lenis
// anchors, which honors scroll-padding-top from landing.css so a section lands just below the fixed
// nav, the same as a native jump does).
const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";

export function SmoothScroll() {
  useEffect(() => {
    const { gsap, ScrollTrigger } = setupGsap();
    const motion = window.matchMedia(MOTION_OK);
    const touchOnly = window.matchMedia(TOUCH_ONLY);
    let stop: (() => void) | null = null;

    const start = () => {
      const lenis = new Lenis({ lerp: 0.11, syncTouch: false, anchors: true });
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      return () => {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33);
        lenis.destroy();
      };
    };

    const sync = () => {
      const want = motion.matches && !touchOnly.matches;
      if (want && !stop) stop = start();
      if (!want && stop) {
        stop();
        stop = null;
      }
    };
    sync();
    motion.addEventListener("change", sync);
    touchOnly.addEventListener("change", sync);

    // Layout settles once the fonts are in; measure the pinned scenes again then.
    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh);
    window.addEventListener("load", refresh);

    return () => {
      window.removeEventListener("load", refresh);
      motion.removeEventListener("change", sync);
      touchOnly.removeEventListener("change", sync);
      stop?.();
      stop = null;
    };
  }, []);
  return null;
}
