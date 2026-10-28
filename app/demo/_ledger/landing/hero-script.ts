import { gsap } from "gsap";
import { MINI_ROWS, MINI_UNTIL, type MiniRow } from "./mini-data";
import type { MiniState } from "./mini-queue";

// The hero's scripted cursor: about 9.5 seconds, played once. A pointer goes to the search bar, the
// palette opens, "lilly" is typed, Enter picks Eli Lilly, C claims it (the gilt ribbon drops and the
// button becomes the chip "Yours until Nov 11"), the rows re-sort with a FLIP so the company you
// hold rises to the top, J and K walk the selection, and L opens the log form, which Escape closes.
// One GSAP timeline drives the pointer and a few state changes; the window redraws itself from that
// state, so everything on screen is real HTML.

export const QUERY = "lilly";
const COMPANY = "Eli Lilly";

export const heroStart = (): MiniState => ({
  rows: MINI_ROWS,
  selectedId: "toyota",
  pressing: null,
  fresh: null,
  palette: { open: false, query: "" },
  log: false,
  note: null,
});

// Yours first, then the rest in their usual order.
const claimed = (rows: MiniRow[]): MiniRow[] => {
  const next = rows.map((r): MiniRow => (r.id === "lilly" ? { ...r, claim: { kind: "mine", until: MINI_UNTIL } } : r));
  return [...next.filter((r) => r.claim.kind === "mine"), ...next.filter((r) => r.claim.kind !== "mine")];
};

// What a person sees when motion is off: the moment after the claim.
export const heroFinal = (): MiniState => ({ ...heroStart(), rows: claimed(MINI_ROWS), selectedId: "lilly" });

type Set = (update: (s: MiniState) => MiniState) => void;

export function buildHeroTimeline({
  root,
  cursor,
  set,
  light,
  onDone,
}: {
  root: HTMLElement;
  cursor: HTMLElement;
  set: Set;
  light: (id: string | null) => void;
  onDone: () => void;
}) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.inOut" }, onComplete: onDone });

  // Where an element is, in the window's own coordinates.
  const at = (selector: string, fx = 0.5, fy = 0.5) => {
    const el = root.querySelector<HTMLElement>(selector);
    const a = root.getBoundingClientRect();
    if (!el) return { x: a.width * 0.6, y: a.height * 0.5 };
    const b = el.getBoundingClientRect();
    return { x: b.left - a.left + b.width * fx, y: b.top - a.top + b.height * fy };
  };
  const press = (time: number) => {
    tl.to(cursor, { scale: 0.82, duration: 0.07, ease: "power2.out" }, time);
    tl.to(cursor, { scale: 1, duration: 0.14, ease: "power2.out" }, time + 0.07);
  };
  const lit = (id: string, time: number, hold = 0.7) => {
    tl.call(() => light(id), [], time);
    tl.call(() => light(null), [], time + hold);
  };
  const patch = (time: number, update: (s: MiniState) => MiniState) => tl.call(() => set(update), [], time);

  // The start of the pass, which is also what Replay returns to.
  tl.call(
    () => {
      set(() => heroStart());
      light(null);
    },
    [],
    0,
  );
  tl.set(cursor, { x: () => root.clientWidth * 0.8, y: () => root.clientHeight * 0.78, opacity: 0, scale: 1 }, 0);
  tl.to(cursor, { opacity: 1, duration: 0.25, ease: "none" }, 0.1);

  // 1. To the search bar, press, the palette opens.
  tl.to(cursor, { x: () => at('[data-mini="search"]', 0.3).x, y: () => at('[data-mini="search"]', 0.3).y, duration: 0.95 }, 0.3);
  press(1.3);
  lit("palette", 1.3, 1.4);
  patch(1.36, (s) => ({ ...s, palette: { open: true, query: "" } }));

  // 2. Type "lilly".
  const typed = { n: 0 };
  tl.to(
    typed,
    {
      n: QUERY.length,
      duration: 0.75,
      ease: "none",
      onUpdate: () => set((s) => ({ ...s, palette: { open: true, query: QUERY.slice(0, Math.round(typed.n)) } })),
    },
    1.75,
  );

  // 3. Enter picks the first result: the palette closes and the selection glides to Eli Lilly.
  patch(3.0, (s) => ({ ...s, palette: { open: false, query: "" }, selectedId: "lilly" }));
  tl.to(cursor, { x: () => at(".ldm-lane", 0.8).x, y: () => at(".ldm-lane", 0.8).y, duration: 0.8 }, 3.0);

  // 4. C claims it: the button presses, becomes the chip, the ribbon drops, a margin note says so.
  lit("claim", 4.0);
  patch(4.0, (s) => ({ ...s, pressing: "lilly" }));
  patch(4.12, (s) => ({
    ...s,
    pressing: null,
    fresh: "lilly",
    rows: s.rows.map((r): MiniRow => (r.id === "lilly" ? { ...r, claim: { kind: "mine", until: MINI_UNTIL } } : r)),
    note: { text: `Claimed ${COMPANY}. Yours until ${MINI_UNTIL}.`, open: false },
  }));
  patch(4.16, (s) => ({ ...s, note: s.note && { ...s.note, open: true } }));
  tl.to(cursor, { opacity: 0, duration: 0.3, ease: "none" }, 4.2);

  // 5. The rows re-sort with a FLIP: the company you hold rises to the top.
  patch(4.9, (s) => ({ ...s, rows: claimed(s.rows) }));

  // 6. J and K walk the selection down two rows and back up.
  lit("j", 6.0, 0.4);
  patch(6.0, (s) => ({ ...s, selectedId: "toyota" }));
  lit("j", 6.5, 0.4);
  patch(6.5, (s) => ({ ...s, selectedId: "siemens" }));
  lit("k", 7.0, 0.4);
  patch(7.0, (s) => ({ ...s, selectedId: "toyota" }));
  lit("k", 7.5, 0.4);
  patch(7.5, (s) => ({ ...s, selectedId: "lilly", note: s.note && { ...s.note, open: false } }));
  patch(7.8, (s) => ({ ...s, note: null }));

  // 7. L opens the log form with the 7 day follow-up chosen, and Escape closes it.
  lit("log", 8.3);
  patch(8.3, (s) => ({ ...s, log: true }));
  patch(9.7, (s) => ({ ...s, log: false, fresh: null }));
  tl.to({}, { duration: 0.2 }, 9.7);
  return tl;
}
