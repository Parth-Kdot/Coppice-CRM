import { anchorSelector, type TourStep } from "@/lib/onboarding-steps";
import { prefersReducedMotion } from "./motion-kit";
import { isEditable, scrollTarget } from "./tour-logic";

// What the onboarding tour reads from the page (tour.tsx draws the cards; tour-logic.ts holds the
// decisions that need no DOM): which real control a card points at, whether it can be seen, where
// to scroll, and whether typed-in text is waiting to be saved.

export const PHONE = "(max-width: 760px)";
export const matches = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

export const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

// The collapsed <details> an element is hidden in (not counting one whose summary holds it).
// Checked directly: browsers can report a size for content inside a closed <details>.
function closedAround(el: HTMLElement): HTMLDetailsElement | null {
  const closed = el.parentElement?.closest<HTMLDetailsElement>("details:not([open])") ?? null;
  return closed && !closed.querySelector(":scope > summary")?.contains(el) ? closed : null;
}

// The first anchor on the page that can be seen (a phone tries its own first). One hidden only by
// collapsed <details> (a Settings section) is revealed by opening them.
export function pickAnchor(step: TourStep): HTMLElement | null {
  const anchors = matches(PHONE) && step.phoneAnchors ? [...step.phoneAnchors, ...step.anchors] : step.anchors;
  for (const anchor of anchors) {
    for (const el of document.querySelectorAll<HTMLElement>(anchorSelector(anchor))) {
      if (el.closest("[data-tour-card]")) continue;
      for (let closed = closedAround(el), guard = 0; closed && guard < 5; closed = closedAround(el), guard++) closed.open = true;
      if (!closedAround(el) && visible(el)) return el;
    }
  }
  return null;
}

// Inside something fixed or sticky (the tab bar, the spine, the header): scrolling won't move it.
function pinned(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

export function scrollIntoBand(el: HTMLElement, card: HTMLElement | null) {
  if (pinned(el)) return;
  const head = document.querySelector<HTMLElement>(".lg-head");
  const headPos = head ? getComputedStyle(head).position : "";
  const viewTop = (head && (headPos === "sticky" || headPos === "fixed") ? head.getBoundingClientRect().bottom : 0) + 8;
  // On a phone the card is a sheet at the bottom: the control goes in the space above it.
  const viewBottom = matches(PHONE) && card ? card.getBoundingClientRect().top - 8 : window.innerHeight - 8;
  const r = el.getBoundingClientRect();
  const top = scrollTarget({ top: r.top, height: r.height, scrollY: window.scrollY, viewTop, viewBottom });
  if (top !== null) window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

// Typed-in text the person hasn't saved: the tour then won't leave the page on its own. Only
// fields people type into count; a select or a checkbox drawn on the client looks "changed" to the
// DOM even when nobody touched it.
export function hasUnsavedInput(): boolean {
  const main = document.getElementById("main");
  if (!main) return false;
  for (const field of main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    if (isEditable(field) && field.value !== field.defaultValue) return true;
  }
  return false;
}

// ?tour= off the address, without a round trip (Next keeps its router in step with replaceState).
export function dropTourParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("tour")) return;
  url.searchParams.delete("tour");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
