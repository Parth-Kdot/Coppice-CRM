"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { REDUCED_MOTION, setupGsap } from "./motion";

// Smooth scrolling on the landing only, wired to GSAP's ticker so ScrollTrigger and Lenis agree on
// the scroll position. Off for reduced motion. Anchor links glide to their section.
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    const { gsap, ScrollTrigger } = setupGsap();
    const lenis = new Lenis({ lerp: 0.11, anchors: { offset: -72 } });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Layout settles once the fonts are in; measure the pinned scenes again then.
    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh);
    window.addEventListener("load", refresh);

    return () => {
      window.removeEventListener("load", refresh);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
