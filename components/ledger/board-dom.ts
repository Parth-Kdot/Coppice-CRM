import type { Stage } from "@/generated/prisma/enums";

// What the board reads from the page: whether a slip is in view, which slip or strip button to
// focus, and the roving tab stop of each column (board-view.tsx draws the board).

// Whether `el` is inside the board's horizontal view (on a phone only one column is).
export function inBoardView(el: Element | null, root: HTMLElement | null): boolean {
  if (!el || !root) return false;
  const r = el.getBoundingClientRect();
  const v = root.getBoundingClientRect();
  return r.width > 0 && r.left >= v.left - 1 && r.right <= v.right + 1;
}
export const stripButton = (stage: Stage) => document.querySelector<HTMLElement>(`[data-strip-stages~="${stage}"]`);

// Roving tabindex: one tab stop per column. The slip links carry no tabIndex prop, so React never
// touches the attribute; this sets it after each render and when focus moves.
export const SLIP_LINK = "[data-slip-link]";
export function rove(link: HTMLElement) {
  const list = link.closest("ul");
  list?.querySelectorAll<HTMLElement>(SLIP_LINK).forEach((el) => el.setAttribute("tabindex", el === link ? "0" : "-1"));
}
export const slipOf = (id: string) => document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(id)}"]`);

export function settleRoving(root: HTMLElement | null) {
  root?.querySelectorAll("ul.lg-slips").forEach((list) => {
    const links = [...list.querySelectorAll<HTMLElement>(SLIP_LINK)];
    if (links.length === 0) return;
    const stop = links.find((el) => el.getAttribute("tabindex") === "0") ?? links[0];
    for (const el of links) el.setAttribute("tabindex", el === stop ? "0" : "-1");
  });
}
