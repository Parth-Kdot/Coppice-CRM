"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type ReactPortal, type RefObject } from "react";
import { createPortal } from "react-dom";

// Positioning for every small floating card (OverflowMenu, and any later popover). Lifted from the
// board's Move to menu (move-menu.tsx), which keeps its own copy for now.
//
//   usePopover(anchor, open, options?)  Returns the ref for the card. While `open`, the card (position:
//                                      fixed, drawn in a portal) sits under the anchor, flips above it
//                                      when there is no room below, stays 8 px inside the viewport,
//                                      and is placed again on resize or when its own size changes.
//                                      options.align: "right" (default, right edges together) or "left".
//                                      options.onDismiss(reason): a pointer down outside the card and the
//                                      anchor ("outside"), or a scroll that carries the anchor away
//                                      ("scroll"). A scroll that leaves the anchor where it was (or one
//                                      inside the card) is ignored.
//   popoverPortal(node, anchor?)        Draws `node` at the end of <body> (or of the open modal <dialog> the
//                                      anchor sits in, which would make <body> inert), so no scrolling
//                                      column clips it.
//   placePopover(...)                   The placement math, pure, for tests.
//   menuIndex(disabled, current, key)   Which item a menu key moves to. Arrows wrap through every item
//                                      (disabled items stay focusable so their reason is read); Home and
//                                      End go to the first and last enabled item.
//
// Positions are written through the CSSOM (style.setProperty), which the strict style policy allows.

export type Rect = { top: number; right: number; bottom: number; left: number };
export type Placement = { left: number; top: number; maxHeight: number; side: "below" | "above" };

export function placePopover({
  anchor,
  width,
  height,
  viewportWidth,
  viewportHeight,
  align = "right",
  gap = 6,
  margin = 8,
}: {
  anchor: Rect;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  align?: "left" | "right";
  gap?: number;
  margin?: number;
}): Placement {
  const wanted = align === "right" ? anchor.right - width : anchor.left;
  const left = Math.max(margin, Math.min(viewportWidth - width - margin, wanted));
  const below = anchor.bottom + gap;
  const roomBelow = viewportHeight - margin - below;
  const roomAbove = anchor.top - gap - margin;
  // Below when it fits there, or when neither side fits and below has more room.
  if (height <= roomBelow || roomBelow >= roomAbove) {
    return { left, top: below, maxHeight: Math.max(0, roomBelow), side: "below" };
  }
  const top = Math.max(margin, anchor.top - height - gap);
  return { left, top, maxHeight: Math.max(0, roomAbove), side: "above" };
}

// Whether the anchor has moved since the menu opened, by more than a pixel either way.
export function anchorMoved(start: Pick<Rect, "top" | "left">, now: Pick<Rect, "top" | "left">, tolerance = 1): boolean {
  return Math.abs(now.top - start.top) > tolerance || Math.abs(now.left - start.left) > tolerance;
}

export type MenuKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

// `current` is -1 when no item has focus yet. Returns -1 for an empty menu.
export function menuIndex(disabled: readonly boolean[], current: number, key: MenuKey): number {
  const count = disabled.length;
  if (count === 0) return -1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") {
    const first = disabled.findIndex((d) => !d);
    return first < 0 ? 0 : first;
  }
  for (let i = count - 1; i >= 0; i--) if (!disabled[i]) return i;
  return count - 1;
}

export type PopoverOptions = {
  align?: "left" | "right";
  gap?: number;
  onDismiss?: (reason: "outside" | "scroll") => void;
};

export function usePopover(anchor: HTMLElement | null, open: boolean, options: PopoverOptions = {}): RefObject<HTMLDivElement | null> {
  const card = useRef<HTMLDivElement>(null);
  const { align = "right", gap = 6 } = options;
  const onDismiss = useRef(options.onDismiss);
  useEffect(() => {
    onDismiss.current = options.onDismiss;
  });

  useLayoutEffect(() => {
    const el = card.current;
    if (!open || !anchor || !el) return;
    const place = () => {
      const p = placePopover({
        anchor: anchor.getBoundingClientRect(),
        width: el.offsetWidth,
        height: el.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align,
        gap,
      });
      el.style.setProperty("left", `${p.left}px`);
      el.style.setProperty("top", `${p.top}px`);
      el.style.setProperty("max-height", `${p.maxHeight}px`);
      // Inside a transformed container (an open sheet) "fixed" is relative to that container, not the
      // viewport: measure once and take the difference out.
      const at = el.getBoundingClientRect();
      if (Math.abs(at.left - p.left) > 0.5) el.style.setProperty("left", `${2 * p.left - at.left}px`);
      if (Math.abs(at.top - p.top) > 0.5) el.style.setProperty("top", `${2 * p.top - at.top}px`);
      el.dataset.side = p.side;
    };
    place();
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [anchor, open, align, gap]);

  useEffect(() => {
    if (!open || !anchor) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card.current?.contains(target) || anchor.contains(target)) return;
      onDismiss.current?.("outside");
    };
    const start = anchor.getBoundingClientRect();
    const onScroll = (event: Event) => {
      if (card.current?.contains(event.target as Node)) return;
      if (anchorMoved(start, anchor.getBoundingClientRect())) onDismiss.current?.("scroll");
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, open]);

  return card;
}

export function popoverPortal(node: ReactNode, anchor?: HTMLElement | null): ReactPortal | null {
  if (typeof document === "undefined") return null;
  // A modal <dialog> makes the rest of the page inert, so inside one the card is drawn in the dialog.
  const host = anchor?.closest<HTMLElement>("dialog[open]") ?? document.body;
  return createPortal(node, host);
}
