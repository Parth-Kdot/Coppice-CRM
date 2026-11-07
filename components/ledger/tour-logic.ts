import { placePopover, type Rect } from "./popover";

// The onboarding tour's decisions that need no DOM, so they are tested directly
// (tests/onboarding-steps.test.ts): where the coach card goes, whether the tour may open by itself,
// and how far to scroll so the highlighted control is in view.

export type Box = { top: number; left: number; width: number; height: number };

export type CardPlace = { place: "beside"; left: number; top: number } | { place: "dock" | "center" | "sheet" };

// Desktop: beside the control (under it, or above when there is no room), never over it. A control
// taller than about half the screen (the queue, the board) keeps the card docked in the corner,
// and a card with no control on the page sits centred. Phone: always the bottom sheet (CSS).
export function placeCard({
  anchor,
  card,
  viewport,
  phone,
}: {
  anchor: Box | null;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  phone: boolean;
}): CardPlace {
  if (phone) return { place: "sheet" };
  if (!anchor) return { place: "center" };
  if (anchor.height > viewport.height * 0.45 || anchor.width > viewport.width * 0.7) return { place: "dock" };
  const rect: Rect = { top: anchor.top, left: anchor.left, right: anchor.left + anchor.width, bottom: anchor.top + anchor.height };
  const p = placePopover({ anchor: rect, width: card.width, height: card.height, viewportWidth: viewport.width, viewportHeight: viewport.height, align: "left", gap: 14, margin: 16 });
  // Neither side has room for the whole card: it would cover the control.
  if (p.maxHeight < card.height) return { place: "dock" };
  return { place: "beside", left: p.left, top: p.top };
}

// The tour opens by itself only on a full page load, and only when nothing is in the way: no
// dialog is open and no text field has focus. Otherwise it waits as the small Resume pill.
export function autoOpenView({ editableFocused, dialogOpen }: { editableFocused: boolean; dialogOpen: boolean }): "card" | "pill" {
  return editableFocused || dialogOpen ? "pill" : "card";
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "number", "password", "date", "datetime-local", "month", "time", "week"]);

// Whether an element is somewhere a person types (the tour never takes focus from one).
export function isEditable(el: { tagName: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && TEXT_INPUTS.has((el.type || "text").toLowerCase());
}

// Where to scroll so a control sits in the visible band [viewTop, viewBottom] (window coordinates),
// centred when it fits; null when it is already in view.
export function scrollTarget({ top, height, scrollY, viewTop, viewBottom }: { top: number; height: number; scrollY: number; viewTop: number; viewBottom: number }): number | null {
  if (top >= viewTop && top + height <= viewBottom) return null;
  const band = Math.max(0, viewBottom - viewTop);
  const offset = height >= band ? viewTop : viewTop + (band - height) / 2;
  return Math.max(0, Math.round(scrollY + top - offset));
}
