import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// GSAP for the landing page only. Called inside effects (never on the server), cleaned up with
// gsap.context or gsap.matchMedia in each section. Most of the motion is transform and opacity. Two
// kinds are not: the self-drawing pen strokes and the stool animate SVG stroke-dashoffset (a paint
// property, kept to small SVGs), and the cut sweep clips an SVG rectangle.
//
// Three durations and two eases, the same as the app: fast feedback 0.12 s, base 0.22 s, slow 0.48 s;
// "lgOut" is the app's ease-out and "power2.inOut" stands in for its in-out. Nothing overshoots.

export const DUR = { fast: 0.12, base: 0.22, slow: 0.48 } as const;

let ready = false;

export function setupGsap() {
  if (!ready && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger, CustomEase);
    // cubic-bezier(.2,.7,.2,1): the growth ease, also the app's ease-out.
    CustomEase.create("lgGrow", "M0,0 C0.2,0.7 0.2,1 1,1");
    ready = true;
  }
  return { gsap, ScrollTrigger };
}

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
// The pinned How it works scene needs room for three columns. Below 700 px wide a phone gets the same
// static page that reduced motion gets: the scene in summer, the four steps as captions, the framed queue.
export const PIN_OK = "(prefers-reduced-motion: no-preference) and (min-width: 700px)";
