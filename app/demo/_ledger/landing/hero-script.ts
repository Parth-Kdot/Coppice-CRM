import { gsap } from "gsap";
import { MINI_ROWS, MINI_UNTIL, type MiniRow } from "./mini-data";
import type { MiniState } from "./mini-queue";

// The hero's scripted cursor: about 9.6 seconds, played once. A pointer comes in from the bottom right
// edge, goes to the search bar, the palette opens, "lilly" is typed and Enter picks Eli Lilly. The
// pointer leaves, so C reads as a key press: the gilt ribbon drops and the button becomes the chip
// "Yours until Nov 11". The pointer returns and presses the "Held by you" total: the list narrows to
// the company you hold with a FLIP, and pressing it again brings the full list back in the usual
// most overdue order, Eli Lilly in its own row with its chip. J and K walk the selection, and L opens
// the log form, which Escape closes. One GSAP timeline drives the pointer and a few state changes;
// the window redraws itself from that state, so everything on screen is real HTML.

export const QUERY = "lilly";
const COMPANY = "Eli Lilly";

export const heroStart = (): MiniState => ({
  rows: MINI_ROWS,
  selectedId: "toyota",
  pressing: null,
  fresh: null,
  onlyMine: false,
  palette: { open: false, query: "" },
  log: false,
  note: null,
});

// The list never re-orders on a claim: the queue sorts by days overdue, so Eli Lilly keeps its place.
const claimed = (rows: MiniRow[]): MiniRow[] => rows.map((r): MiniRow => (r.id === "lilly" ? { ...r, claim: { kind: "mine", until: MINI_UNTIL } } : r));

// What a person sees when motion is off (and in the framed queue of the Four Seasons scene): the
// moment after the claim, in most overdue order.
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
  // The pointer starts off the table, at the right edge by the footer, and leaves before the C beat.
  tl.set(cursor, { x: () => root.clientWidth - 30, y: () => root.clientHeight - 26, opacity: 0, scale: 1 }, 0);
  tl.to(cursor, { opacity: 1, duration: 0.2, ease: "none" }, 0.1);

  // 1. To the search bar, press, the palette opens.
  tl.to(cursor, { x: () => at('[data-mini="search"]', 0.3).x, y: () => at('[data-mini="search"]', 0.3).y, duration: 0.8 }, 0.25);
  press(1.1);
  lit("palette", 1.1, 1.2);
  patch(1.16, (s) => ({ ...s, palette: { open: true, query: "" } }));

  // 2. Type "lilly". The pointer steps away while the keys do the work.
  const typed = { n: 0 };
  tl.to(
    typed,
    {
      n: QUERY.length,
      duration: 0.65,
      ease: "none",
      onUpdate: () => set((s) => ({ ...s, palette: { open: true, query: QUERY.slice(0, Math.round(typed.n)) } })),
    },
    1.5,
  );
  tl.to(cursor, { opacity: 0, duration: 0.25, ease: "none" }, 1.7);

  // 3. Enter picks the first result: the palette closes and the selection glides to Eli Lilly.
  patch(2.6, (s) => ({ ...s, palette: { open: false, query: "" }, selectedId: "lilly" }));

  // 4. C claims it: the button presses, becomes the chip, the ribbon drops, a margin note says so.
  lit("claim", 3.3);
  patch(3.3, (s) => ({ ...s, pressing: "lilly" }));
  patch(3.42, (s) => ({
    ...s,
    pressing: null,
    fresh: "lilly",
    rows: s.rows.map((r): MiniRow => (r.id === "lilly" ? { ...r, claim: { kind: "mine", until: MINI_UNTIL } } : r)),
    note: { text: `Claimed ${COMPANY}. Yours until ${MINI_UNTIL}.`, open: false },
  }));
  patch(3.46, (s) => ({ ...s, note: s.note && { ...s.note, open: true } }));

  // 5. The pointer returns and presses "Held by you": the list narrows to Eli Lilly with a FLIP.
  //    Pressing it again brings the full list back, most overdue first, Eli Lilly in its own row.
  tl.set(cursor, { x: () => at(".ldm-lane", 0.85).x, y: () => at(".ldm-lane", 0.5).y }, 3.9);
  tl.to(cursor, { opacity: 1, duration: 0.2, ease: "none" }, 3.9);
  tl.to(cursor, { x: () => at('[data-mini="total-mine"]', 0.45).x, y: () => at('[data-mini="total-mine"]', 0.5).y, duration: 0.6 }, 3.95);
  press(4.6);
  patch(4.67, (s) => ({ ...s, onlyMine: true, selectedId: "lilly" }));
  press(5.9);
  patch(5.97, (s) => ({ ...s, onlyMine: false, note: s.note && { ...s.note, open: false } }));
  patch(6.3, (s) => ({ ...s, note: null }));
  tl.to(cursor, { opacity: 0, duration: 0.25, ease: "none" }, 6.15);

  // 6. J and K walk the selection down two rows and back up.
  lit("j", 6.6, 0.35);
  patch(6.6, (s) => ({ ...s, selectedId: "cummins" }));
  lit("j", 7.05, 0.35);
  patch(7.05, (s) => ({ ...s, selectedId: "lockheed" }));
  lit("k", 7.5, 0.35);
  patch(7.5, (s) => ({ ...s, selectedId: "cummins" }));
  lit("k", 7.95, 0.35);
  patch(7.95, (s) => ({ ...s, selectedId: "lilly" }));

  // 7. L opens the log form with the 7 day follow-up chosen, and Escape closes it.
  lit("log", 8.4);
  patch(8.4, (s) => ({ ...s, log: true }));
  patch(9.7, (s) => ({ ...s, log: false, fresh: null }));
  tl.to({}, { duration: 0.2 }, 9.7);
  return tl;
}
