import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// GSAP for the landing page only. Called inside effects (never on the server), cleaned up with
// gsap.context or gsap.matchMedia in each section. Everything animates transform, opacity, filter
// or SVG stroke offsets, so scrolling stays smooth.

let ready = false;

export function setupGsap() {
  if (!ready && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger, CustomEase);
    // cubic-bezier(.2,.7,.2,1): the growth ease from the brief.
    CustomEase.create("lgGrow", "M0,0 C0.2,0.7 0.2,1 1,1");
    ready = true;
  }
  return { gsap, ScrollTrigger };
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
