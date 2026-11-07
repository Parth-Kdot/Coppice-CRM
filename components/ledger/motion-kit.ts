"use client";

import type { gsap as GsapNamespace } from "gsap";

/* ------------------------------------------------------------------------------------------
   The motion kit: the app's "finish" and "remove" moments, on GSAP.

   Motion in Coppice is a reward. It plays when someone finishes something or takes something
   off the screen, so doing the work feels good and they want to do it again. It never plays on
   page load, on hover, on focus or while something is loading. Four moves, one feel: short
   (each under 450 ms), the app's ease (cubic-bezier(.2,.7,.2,1), the --ease-out token), moss and
   paper colors read from the tokens, nothing that overshoots.

     completeStamp(el, { mark })   Done. A quick press-in, a moss ring that fades out, and an
                                   optional mark (a check, a stamp) that settles down onto it.
                                   For: a step ticked, a reply logged, a claim taken, a draft sent.
     removeAway(el, opts)          Gone. The item slides and fades out, then its height closes so
                                   what is below moves up. Resolves when it is finished; the caller
                                   then removes the item from state. For: dismissed, archived,
                                   released, deleted, snoozed.
     sendTo(el, target, opts)      Moved. The item flies toward another place on the screen and
                                   fades into it, its old slot closes, and the target answers with
                                   a small pulse. For: a card to a board column, a fact to the
                                   "Verified" heading, a row to "Done".
     celebrate(el, { mark })       A big finish. A small lift and one soft ring. For: an import
                                   finished, a tour finished, a stage closed. Once per moment, not
                                   on every row.

   Usage, in a client component (these are event handlers, never render code):

     import { completeStamp, removeAway, sendTo, celebrate, restore } from "@/components/ledger/motion-kit";

     // Remove: start the server action and the move together; the UI never waits on the animation
     // to stay correct, only to look smooth.
     async function onArchive(id: string, row: HTMLElement) {
       const leaving = removeAway(row, { focus: nextRowButton });
       const result = await archiveCompany(id);
       if (!result.ok) { restore(row); showError(result.error); return; }
       await leaving;
       setRows((rows) => rows.filter((r) => r.id !== id));
     }

     // Finish: fire and forget.
     void completeStamp(stepRef.current, { mark: tickRef.current });

     // Move to another place, then let state re-render it there.
     await sendTo(card, columnHeading, { focus: nextCard });
     setStage(id, "replied");

     // A big finish.
     void celebrate(summaryRef.current);

   Rules every move keeps:
   - GSAP is loaded on the first move (or preloadMotion()), once, so a page that never animates
     never downloads it.
   - Reduced motion, a hidden tab, a missing or detached element, or GSAP failing to load: the move
     is skipped and the promise resolves at once. Nothing depends on the animation having played.
   - Every promise resolves, even if the browser stops running frames: a timer behind each move
     jumps it to its end.
   - Nothing traps focus or delays the state change. A leaving item stops taking clicks; if focus
     was inside it, pass `focus` and it moves there at the start. Call the server first or at the
     same time, and await the move only before taking the item out of state.
   - Clean up: completeStamp, celebrate and the target pulse put the element's inline styles back
     as they were when they end. removeAway and sendTo leave the item in its end state (hidden,
     collapsed) for the caller to remove; restore(el) brings it back if the change failed. Key list
     items by id so React never reuses a hidden node for another item.
   - Strict CSP: GSAP writes through the CSSOM (element.style), which the style-src policy allows.
     Nothing here sets a style attribute or renders one on the server.
   - One move per element at a time. A new completeStamp or celebrate on the same element finishes
     the old one first; an element already leaving (removeAway, sendTo) ignores further moves.

   Limits: transforms don't apply to inline elements, so stamp a block or inline-block. The collapse animates height (or width) with padding, margin and border, so it suits
   block and flex items. It cannot close a table row or a grid gap; pass `collapse: false` there
   and let the re-render close the space. A flight inside a scrolling column is clipped by it, so
   sendTo travels most of the way (`reach`) and fades rather than crossing the whole screen.
   ------------------------------------------------------------------------------------------ */

type Gsap = typeof GsapNamespace;
type Timeline = ReturnType<Gsap["timeline"]>;
type Context = ReturnType<Gsap["context"]>;
type Ease = (progress: number) => number;

export type MoveName = "completeStamp" | "removeAway" | "sendTo" | "celebrate" | "land";

// Seconds, the same three steps as the --dur-* tokens.
export const DUR = { fast: 0.12, base: 0.22, slow: 0.48 } as const;
// The longest any one move may run, start to resolve.
export const MOVE_LIMIT_S = 0.45;
// How long past its planned end a move may run before its timer finishes it.
export const FINISH_SLACK_MS = 250;

export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Token fallbacks, for when the custom properties can't be read.
const FALLBACK = { moss: "#2f5233", moss2: "#456b47", paper: "#f6f1e6" } as const;

// The schedule of every move: when each part starts and how long it runs, in seconds. The moves
// below are built from these numbers, and the tests check every move ends within MOVE_LIMIT_S.
export const TIMING = {
  completeStamp: {
    press: { at: 0, dur: 0.09 },
    settle: { at: 0.09, dur: DUR.base },
    ring: { at: 0.05, dur: 0.38 },
    mark: { at: 0.06, dur: 0.26 },
  },
  removeAway: {
    slide: { at: 0, dur: DUR.base },
    collapse: { at: 0.16, dur: DUR.base },
  },
  sendTo: {
    flight: { at: 0, dur: 0.28 },
    fade: { at: 0.1, dur: 0.18 },
    collapse: { at: 0.2, dur: 0.2 },
    land: { at: 0.2, dur: 0.24 },
  },
  celebrate: {
    lift: { at: 0, dur: 0.14 },
    drop: { at: 0.14, dur: 0.26 },
    ring: { at: 0, dur: 0.44 },
    mark: { at: 0.08, dur: 0.26 },
  },
  land: {
    swell: { at: 0, dur: 0.1 },
    ease: { at: 0.1, dur: 0.14 },
    ring: { at: 0, dur: 0.24 },
  },
} as const satisfies Record<MoveName, Record<string, { at: number; dur: number }>>;

/** When the last part of a move ends, in seconds. */
export function moveSpan(parts: Record<string, { at: number; dur: number }>): number {
  return Object.values(parts).reduce((end, part) => Math.max(end, part.at + part.dur), 0);
}

/* ---------- Pure helpers (tested in tests/motion-kit.test.ts) ---------- */

export type Direction = "left" | "right" | "up" | "down";

/** Where a leaving item slides to. */
export function exitOffset(direction: Direction = "left", distance = 16): { x: number; y: number } {
  const d = Math.max(0, distance);
  const back = d ? -d : 0;
  switch (direction) {
    case "right":
      return { x: d, y: 0 };
    case "up":
      return { x: 0, y: back };
    case "down":
      return { x: 0, y: d };
    default:
      return { x: back, y: 0 };
  }
}

export type RectLike = { left: number; top: number; width: number; height: number };

/** How far a flying item travels: `reach` of the way from its center to the target's center,
 *  no farther than `maxPx` (direction kept). */
export function flightVector(from: RectLike, to: RectLike, { reach = 0.85, maxPx = 560 }: { reach?: number; maxPx?: number } = {}): { x: number; y: number } {
  const r = Math.min(1, Math.max(0, reach));
  let x = (to.left + to.width / 2 - (from.left + from.width / 2)) * r;
  let y = (to.top + to.height / 2 - (from.top + from.height / 2)) * r;
  const length = Math.hypot(x, y);
  const cap = Math.max(0, maxPx);
  if (length > cap && length > 0) {
    x = (x / length) * cap;
    y = (y / length) * cap;
  }
  return { x: Math.round(x * 10) / 10 || 0, y: Math.round(y * 10) / 10 || 0 };
}

/** "#rgb" or "#rrggbb" to rgba() with the given alpha, or null if it isn't a hex color. */
export function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const n = Number.parseInt(h, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A seal-like ring as a box-shadow: a thin paper gap, then moss. `base` keeps the element's own
 *  shadow underneath so it doesn't blink off while the ring plays. */
export function ringShadow({ paper, moss, gap, spread, paperAlpha, mossAlpha, base }: { paper: string; moss: string; gap: number; spread: number; paperAlpha: number; mossAlpha: number; base?: string }): string {
  const p = hexToRgba(paper, paperAlpha) ?? hexToRgba(FALLBACK.paper, paperAlpha)!;
  const m = hexToRgba(moss, mossAlpha) ?? hexToRgba(FALLBACK.moss2, mossAlpha)!;
  const rings = `0 0 0 ${gap}px ${p}, 0 0 0 ${Math.max(gap, spread)}px ${m}`;
  return base && base !== "none" ? `${rings}, ${base}` : rings;
}

/** Whether a move should play at all. */
export function shouldAnimate({ reduced, hidden, connected }: { reduced: boolean; hidden: boolean; connected: boolean }): boolean {
  return connected && !reduced && !hidden;
}

/* ---------- Environment ---------- */

/** Whether the person asked for reduced motion. False on the server. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

function canAnimate(el: Element): boolean {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return shouldAnimate({ reduced: prefersReducedMotion(), hidden, connected: el.isConnected });
}

function isElement(el: unknown): el is HTMLElement | SVGElement {
  return typeof Element !== "undefined" && el instanceof Element;
}

function token(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return hexToRgba(value, 1) ? value : fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Loading GSAP, once ---------- */

type Kit = { gsap: Gsap; out: Ease; inOut: Ease };
let loading: Promise<Kit | null> | undefined;

function loadKit(): Promise<Kit | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  loading ??= Promise.all([import("gsap"), import("gsap/CustomEase")])
    .then(([core, custom]) => {
      const gsap = core.gsap ?? (core.default as unknown as Gsap);
      const { CustomEase } = custom;
      gsap.registerPlugin(CustomEase);
      return {
        gsap,
        // The --ease-out and --ease-inout tokens.
        out: CustomEase.create("kitOut", "M0,0 C0.2,0.7 0.2,1 1,1"),
        inOut: CustomEase.create("kitInOut", "M0,0 C0.4,0 0.2,1 1,1"),
      };
    })
    .catch(() => {
      loading = undefined; // try again on the next move
      return null;
    });
  return loading;
}

/** Starts loading GSAP without playing anything, e.g. in an effect on a screen whose next click
 *  is likely to finish something. Optional: the first move loads it anyway. */
export function preloadMotion(): void {
  void loadKit();
}

/* ---------- The runner every move shares ---------- */

// finish: jump to the end state and resolve. settle: resolve without touching styles.
type Running = { kind: MoveName; keep: boolean; promise: Promise<void>; finish: () => void; settle: () => void; ctx?: Context; tl?: Timeline };
const running = new WeakMap<Element, Running>();

// Plays one move on `el`. `keep` moves (an item leaving) stay in their end state; the others put
// the element's inline styles back when they end.
function play(kind: MoveName, el: Element | null | undefined, keep: boolean, build: (kit: Kit, tl: Timeline, el: HTMLElement | SVGElement) => void): Promise<void> {
  if (!isElement(el)) return Promise.resolve();
  const previous = running.get(el);
  if (previous?.keep) return previous.promise; // already leaving
  previous?.finish();
  if (!canAnimate(el)) return Promise.resolve();

  const record = { kind, keep } as Running;
  record.promise = new Promise<void>((resolve) => {
    let settled = false;
    let timer: number | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!keep) {
        record.ctx?.revert();
        if (running.get(el) === record) running.delete(el);
      }
      resolve();
    };
    record.settle = done;
    record.finish = () => {
      record.tl?.progress(1);
      done();
    };
    loadKit().then((kit) => {
      if (settled) return;
      if (!kit || !el.isConnected) return done();
      try {
        record.ctx = kit.gsap.context(() => {
          record.tl = kit.gsap.timeline({ onComplete: done });
          quietCss(record.tl, el, keep);
          build(kit, record.tl, el);
        });
        const tl = record.tl!;
        timer = window.setTimeout(record.finish, tl.duration() * 1000 + FINISH_SLACK_MS);
      } catch {
        record.ctx?.revert();
        done();
      }
    }, done);
  });
  running.set(el, record);
  return record.promise;
}

// A CSS transition on a property GSAP is writing would chase every frame, and a running CSS
// animation outranks inline styles; both are paused on the element for the move (and put back
// with everything else when it ends). A leaving item drops its animations outright.
const FOUGHT = /\b(all|transform|translate|scale|rotate|opacity|box-shadow|height|width|padding|margin)\b/;
function quietCss(tl: Timeline, node: Element, leaving: boolean) {
  const cs = getComputedStyle(node);
  const vars: Record<string, string> = {};
  if (FOUGHT.test(cs.transitionProperty) && cs.transitionDuration.split(",").some((d) => Number.parseFloat(d) > 0)) vars.transition = "none";
  if (leaving && cs.animationName !== "none") vars.animation = "none";
  if (Object.keys(vars).length) tl.set(node, vars, 0);
}

/** Brings back an item that removeAway or sendTo hid, e.g. when the server refused the change.
 *  Instant. Its pending promise resolves. A no-op on an element that isn't leaving. */
export function restore(el: Element | null | undefined): void {
  if (!isElement(el)) return;
  const record = running.get(el);
  if (!record) return;
  running.delete(el);
  record.tl?.kill();
  record.ctx?.revert();
  record.settle();
}

// Moves focus to `next` if it is inside `el` now, so removing `el` never drops focus to the page.
function handOffFocus(el: Element, next: HTMLElement | null | undefined) {
  if (!next || typeof document === "undefined") return;
  if (el.contains(document.activeElement)) next.focus({ preventScroll: true });
}

/* ---------- The moves ---------- */

/** Done: a quick press-in and a moss ring; `mark` (a check or stamp, inside or near `el`)
 *  settles down onto it. */
export function completeStamp(el: Element | null | undefined, { mark }: { mark?: Element | null } = {}): Promise<void> {
  const t = TIMING.completeStamp;
  return play("completeStamp", el, false, ({ gsap, out, inOut }, tl, node) => {
    const base = getComputedStyle(node).boxShadow;
    const paper = token("--paper", FALLBACK.paper);
    const moss = token("--moss-2", FALLBACK.moss2);
    tl.to(node, { scale: 0.965, duration: t.press.dur, ease: inOut }, t.press.at);
    tl.to(node, { scale: 1, duration: t.settle.dur, ease: out }, t.settle.at);
    tl.fromTo(
      node,
      { boxShadow: ringShadow({ paper, moss, gap: 0, spread: 0, paperAlpha: 1, mossAlpha: 0.55, base }) },
      { boxShadow: ringShadow({ paper, moss, gap: 2, spread: 7, paperAlpha: 0, mossAlpha: 0, base }), duration: t.ring.dur, ease: out },
      t.ring.at,
    );
    if (isElement(mark)) {
      gsap.set(mark, { transformOrigin: "50% 50%" });
      tl.fromTo(mark, { scale: 1.4, rotation: -10, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: t.mark.dur, ease: out }, t.mark.at);
    }
  });
}

export type RemoveOptions = {
  /** Which way it slides. Default "left", like the rest of the app's exits. */
  direction?: Direction;
  /** How far it slides, in px. Default 16. */
  distance?: number;
  /** What closes after it: its "height" (default), its "width" (a chip in a row), or nothing. */
  collapse?: "height" | "width" | false;
  /** Where focus goes if it is inside the item. Moved at the start. */
  focus?: HTMLElement | null;
};

/** Gone: slides and fades out, then closes its space. Resolves when finished; remove the item
 *  from state then. The item stays hidden until you do (or call restore). */
export function removeAway(el: Element | null | undefined, { direction = "left", distance = 16, collapse = "height", focus }: RemoveOptions = {}): Promise<void> {
  if (isElement(el)) handOffFocus(el, focus);
  const t = TIMING.removeAway;
  return play("removeAway", el, true, ({ out }, tl, node) => {
    const { x, y } = exitOffset(direction, distance);
    tl.set(node, { pointerEvents: "none" }, 0);
    tl.to(node, { x, y, opacity: 0, duration: t.slide.dur, ease: out }, t.slide.at);
    if (collapse) closeSpace(tl, node, collapse, t.collapse, out);
  });
}

function closeSpace(tl: Timeline, node: Element, axis: "height" | "width", at: { at: number; dur: number }, ease: Ease) {
  const vars =
    axis === "height"
      ? { height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, borderTopWidth: 0, borderBottomWidth: 0 }
      : { width: 0, minWidth: 0, paddingLeft: 0, paddingRight: 0, marginLeft: 0, marginRight: 0, borderLeftWidth: 0, borderRightWidth: 0 };
  tl.set(node, { overflow: "hidden" }, at.at);
  tl.to(node, { ...vars, duration: at.dur, ease }, at.at);
}

export type SendOptions = {
  /** Share of the way to the target the item travels before it has faded. Default 0.85. */
  reach?: number;
  /** Close the item's old slot as it goes. Default "height". */
  collapse?: "height" | "width" | false;
  /** Pulse the target when the item lands. Default true. */
  pulseTarget?: boolean;
  /** Where focus goes if it is inside the item. Moved at the start. */
  focus?: HTMLElement | null;
};

/** Moved: flies toward `target` (a column, a heading), fades into it, closes its old slot, and the
 *  target pulses. Resolves when finished; render the item in its new place then. */
export function sendTo(el: Element | null | undefined, target: Element | null | undefined, { reach, collapse = "height", pulseTarget = true, focus }: SendOptions = {}): Promise<void> {
  if (!isElement(target)) return removeAway(el, { collapse: collapse || false, focus });
  if (isElement(el)) handOffFocus(el, focus);
  const t = TIMING.sendTo;
  let landing: Promise<void> = Promise.resolve();
  const flying = play("sendTo", el, true, ({ out, inOut }, tl, node) => {
    const { x, y } = flightVector(node.getBoundingClientRect(), target.getBoundingClientRect(), { reach });
    const lift: Record<string, string | number> = { pointerEvents: "none", zIndex: 1 };
    if (getComputedStyle(node).position === "static") lift.position = "relative";
    tl.set(node, lift, 0);
    tl.to(node, { x, y, scale: 0.9, duration: t.flight.dur, ease: inOut }, t.flight.at);
    tl.to(node, { opacity: 0, duration: t.fade.dur, ease: out }, t.fade.at);
    if (collapse) closeSpace(tl, node, collapse, t.collapse, out);
    if (pulseTarget) tl.call(() => void (landing = land(target)), undefined, t.land.at);
  });
  return flying.then(() => landing);
}

// The target's answer when something lands on it: a small swell and a faint ring.
function land(target: Element): Promise<void> {
  const t = TIMING.land;
  return play("land", target, false, ({ out, inOut }, tl, node) => {
    const base = getComputedStyle(node).boxShadow;
    const paper = token("--paper", FALLBACK.paper);
    const moss = token("--moss-2", FALLBACK.moss2);
    tl.to(node, { scale: 1.03, duration: t.swell.dur, ease: inOut }, t.swell.at);
    tl.to(node, { scale: 1, duration: t.ease.dur, ease: out }, t.ease.at);
    tl.fromTo(
      node,
      { boxShadow: ringShadow({ paper, moss, gap: 0, spread: 0, paperAlpha: 1, mossAlpha: 0.35, base }) },
      { boxShadow: ringShadow({ paper, moss, gap: 2, spread: 6, paperAlpha: 0, mossAlpha: 0, base }), duration: t.ring.dur, ease: out },
      t.ring.at,
    );
  });
}

/** A big finish: a small lift, one soft moss ring, and an optional `mark` that settles. Once per
 *  moment (an import done, a tour finished), never per row. */
export function celebrate(el: Element | null | undefined, { mark }: { mark?: Element | null } = {}): Promise<void> {
  const t = TIMING.celebrate;
  return play("celebrate", el, false, ({ gsap, out, inOut }, tl, node) => {
    const base = getComputedStyle(node).boxShadow;
    const paper = token("--paper", FALLBACK.paper);
    const moss = token("--moss-2", FALLBACK.moss2);
    tl.to(node, { y: -3, duration: t.lift.dur, ease: inOut }, t.lift.at);
    tl.to(node, { y: 0, duration: t.drop.dur, ease: out }, t.drop.at);
    tl.fromTo(
      node,
      { boxShadow: ringShadow({ paper, moss, gap: 0, spread: 0, paperAlpha: 1, mossAlpha: 0.45, base }) },
      { boxShadow: ringShadow({ paper, moss, gap: 3, spread: 12, paperAlpha: 0, mossAlpha: 0, base }), duration: t.ring.dur, ease: out },
      t.ring.at,
    );
    if (isElement(mark)) {
      gsap.set(mark, { transformOrigin: "50% 50%" });
      tl.fromTo(mark, { scale: 1.3, rotation: -8, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: t.mark.dur, ease: out }, t.mark.at);
    }
  });
}
