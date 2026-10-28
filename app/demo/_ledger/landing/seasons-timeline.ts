import type { gsap } from "gsap";
import { CUT_Y } from "./seasons-scene";

// The timeline of the pinned How it works scene, in units. Each of the four seasons gets SEASON
// units, and the framed queue gets the last QUEUE units. The scroll pace is the pace the scene had
// when a season was 1 unit and the pin was 150% of the screen over 5.6 units, so the extra beats add
// scroll distance and do not make anything faster or slower.
export const SEASON = 1.6;
const QUEUE = 1.6;
export const TOTAL = 4 * SEASON + QUEUE;
const PIN_PERCENT_PER_UNIT = 150 / 5.6;
export const PIN_END = `+=${(PIN_PERCENT_PER_UNIT * TOTAL).toFixed(1)}%`;
// The season shown in the tabs, captions and tint: 0 to 3, then 4 while the framed queue is up.
export const seasonAt = (progress: number) => Math.min(4, Math.floor((progress * TOTAL) / SEASON));

type Gsap = typeof gsap;

// Times inside a season are written as offsets from its start.
const at = (season: number, offset: number) => season * SEASON + offset;

export function buildSeasonsTimeline(el: HTMLElement, g: Gsap) {
  const q = g.utils.selector(el);
  const tl = g.timeline({ defaults: { ease: "none" } });
  const one = (selector: string) => el.querySelector<HTMLElement>(selector);
  const pane = (i: number) => one(`.ld-pane[data-i="${i}"]`);

  // The moss check beside a beat draws as the beat happens, and the beat's line comes up to full ink.
  const beat = (season: number, index: number, t: number) => {
    const li = el.querySelectorAll(".ld-caption")[season]?.querySelectorAll(".ld-beat")[index];
    if (!li) return;
    tl.fromTo(li, { opacity: 0.55 }, { opacity: 1, duration: 0.1 }, t);
    draw(li.querySelector(".ld-tick path"), t);
  };
  const draw = (path: Element | null, t: number, dur = 0.1) => {
    if (path) tl.fromTo(path, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.out" }, t);
  };
  // A chip is picked: its ink layer comes up over the quiet label.
  const pick = (chip: Element | null | undefined, t: number) => {
    const on = chip?.querySelector(".ld-pick-on");
    if (on) tl.fromTo(on, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "power1.out" }, t);
  };
  // Handwriting: the text is uncovered from the left, so it reads as being written.
  const write = (target: string, t: number, dur: number) => {
    tl.fromTo(target, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: dur, ease: "none" }, t);
  };
  // A swap of two lines in the same place: the first line is quiet in the finished page.
  const swap = (before: string, after: string, t: number) => {
    tl.fromTo(before, { opacity: 1 }, { opacity: 0, duration: 0.1 }, t);
    tl.fromTo(after, { opacity: 0 }, { opacity: 1, duration: 0.1 }, t);
  };

  const grow = (group: string, count: number, startAt: number, step: number, dur: number) => {
    for (let i = 0; i < count; i++) {
      const shoot = el.querySelector<SVGGElement>(`[data-shoot="${group}${i}"]`);
      if (!shoot) continue;
      const start = startAt + i * step;
      tl.fromTo(shoot.querySelectorAll(".lg-stem, .lg-stem-thin"), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: "power2.out" }, start);
      shoot.querySelectorAll<SVGGElement>(".lg-leaf").forEach((leaf) => {
        const t = Number(leaf.dataset.t ?? 1);
        tl.fromTo(leaf, { scale: 0, transformOrigin: "0% 50%" }, { scale: 1, duration: 0.14, ease: "back.out(2)" }, start + dur * (1 - Math.pow(1 - t, 1 / 2.4)));
      });
    }
  };

  // ---- Autumn, Import. Rows of the old sheet are read one by one and a shoot grows with each; the
  // columns are mapped; a look-alike pair is flagged and skipped; the summary lands.
  const A = 0;
  grow("a", 3, at(A, 0.06), 0.17, 0.5);
  q(".ld-old-row").forEach((row, i) => {
    tl.fromTo(row, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, at(A, 0.06 + i * 0.17));
  });
  tl.fromTo(q(".ld-old-more"), { opacity: 0 }, { opacity: 1, duration: 0.1 }, at(A, 0.56));
  beat(A, 0, at(A, 0.66));
  q(".ld-map-tick path").forEach((path, i) => draw(path, at(A, 0.72 + i * 0.08), 0.08));
  beat(A, 1, at(A, 0.98));
  tl.fromTo(q(".ld-lookalike"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, at(A, 1.02));
  const looks = q(".ld-look-row");
  pick(looks[0]?.querySelector(".ld-pick[data-on='true']"), at(A, 1.2));
  pick(looks[1]?.querySelector(".ld-pick[data-on='true']"), at(A, 1.26));
  tl.fromTo(q(".ld-look-row .ld-pen"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.08, ease: "power2.out" }, at(A, 1.28));
  beat(A, 2, at(A, 1.34));
  tl.fromTo(q(".ld-import-card"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, at(A, 1.36));
  draw(one(".ld-import-tick path"), at(A, 1.44));
  tl.to(pane(0), { opacity: 0, duration: 0.1 }, at(A, 1.52));

  // ---- Winter, Claim. Names hang from the stems, the ticket's Claim button becomes the solid chip as
  // the gilt ribbon drops, then a second officer's attempt is refused and the held tag shakes.
  const W = 1;
  tl.fromTo(pane(1), { opacity: 0 }, { opacity: 1, duration: 0.1 }, at(W, 0));
  q(".ld-claim-tag").forEach((tag, i) => {
    tl.fromTo(tag, { opacity: 0, rotation: i % 2 ? 8 : -8, transformOrigin: "50% 0%" }, { opacity: 1, rotation: 0, duration: 0.2, ease: "back.out(1.6)" }, at(W, 0.04 + i * 0.1));
  });
  tl.fromTo(q(".ld-ticket"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, at(W, 0.1));
  tl.fromTo(q(".ld-claim-free"), { opacity: 0 }, { opacity: 1, duration: 0.12 }, at(W, 0.36));
  q(".ld-claim-note:not(.ld-claim-note-mine)").forEach((note) => {
    tl.fromTo(note, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power1.out" }, at(W, 0.36));
  });
  beat(W, 0, at(W, 0.5));
  // The press: the button dips, the chip grows out of it, the ribbon drops on the ticket and on the tag.
  tl.to(q(".ld-claim-btn"), { scale: 0.94, duration: 0.05 }, at(W, 0.6));
  tl.fromTo(q(".ld-claim-btn"), { opacity: 1 }, { opacity: 0, duration: 0.1 }, at(W, 0.66));
  tl.fromTo(q(".ld-claim-chip"), { opacity: 0, clipPath: "inset(0% 62% 0% 0%)" }, { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 0.16, ease: "power2.out" }, at(W, 0.66));
  swap(".ld-ticket-free", ".ld-ticket-mine", at(W, 0.68));
  tl.fromTo(q(".ld-ticket-ribbon"), { scaleY: 0, transformOrigin: "50% 0%" }, { scaleY: 1, duration: 0.18, ease: "back.out(2)" }, at(W, 0.7));
  tl.fromTo(q(".ld-claim-ribbon"), { scaleY: 0, transformOrigin: "50% 0%" }, { scaleY: 1, duration: 0.18, ease: "back.out(2)" }, at(W, 0.7));
  tl.to(q(".ld-claim-free-mine"), { opacity: 0, duration: 0.08 }, at(W, 0.68));
  tl.fromTo(q(".ld-claim-note-mine"), { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "power1.out" }, at(W, 0.74));
  beat(W, 1, at(W, 0.92));
  // The second officer: a dashed line, the refusal in the margin and, together with it, the shake.
  tl.fromTo(q(".ld-attempt-line"), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.14, ease: "power2.out" }, at(W, 1.0));
  tl.fromTo(q(".ld-attempt-note"), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.14, ease: "power2.out" }, at(W, 1.16));
  const held = q(".ld-claim-tag")[0];
  let shakeAt = at(W, 1.16);
  [
    [2.6, 0.04],
    [-2.2, 0.06],
    [1.6, 0.05],
    [-1, 0.04],
    [0, 0.04],
  ].forEach(([rotation, dur]) => {
    tl.to(held, { rotation, duration: dur, ease: "sine.inOut" }, shakeAt);
    shakeAt += dur;
  });
  beat(W, 2, at(W, 1.4));
  tl.to(pane(1), { opacity: 0, duration: 0.1 }, at(W, 1.5));

  // ---- Spring, Log and follow up. A fast log entry fills in and is saved into the first ledger row;
  // later the company is due again, and a reply fills its stage glyph.
  const S = 2;
  tl.fromTo(pane(2), { opacity: 0 }, { opacity: 1, duration: 0.1 }, at(S, 0.02));
  const ledgerRows = q(".ld-ledger-row");
  pick(one(".ld-log-channels .ld-pick[data-on='true']"), at(S, 0.18));
  write(".ld-log-ink", at(S, 0.3), 0.28);
  pick(one(".ld-log-follow .ld-pick[data-on='true']"), at(S, 0.62));
  beat(S, 0, at(S, 0.74));
  pick(one(".ld-log-save"), at(S, 0.84));
  tl.to(q(".ld-log"), { opacity: 0, y: -10, duration: 0.12, ease: "power1.in" }, at(S, 0.94));
  tl.fromTo(ledgerRows[0], { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.14, ease: "power2.out" }, at(S, 0.9));
  draw(one(".ld-row-tick path"), at(S, 1.02));
  beat(S, 1, at(S, 1.06));
  tl.fromTo(q(".ld-claim-glyph"), { opacity: 0 }, { opacity: 1, duration: 0.12 }, at(S, 1.0));
  tl.fromTo(q(".ld-claim-glyph .ld-glyph-q2"), { opacity: 0 }, { opacity: 1, duration: 0.14 }, at(S, 1.36));
  tl.fromTo(q(".ld-due"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.12, ease: "power2.out" }, at(S, 1.08));
  swap(".ld-due-when .ld-due-before", ".ld-due-when .ld-due-after", at(S, 1.22));
  swap(".ld-due-labels .ld-due-before", ".ld-due-labels .ld-due-after", at(S, 1.36));
  tl.fromTo(q(".ld-due .ld-glyph-q2"), { opacity: 0 }, { opacity: 1, duration: 0.14 }, at(S, 1.36));
  beat(S, 2, at(S, 1.5));
  ledgerRows.slice(1).forEach((row, i) => {
    tl.fromTo(row, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.12, ease: "power2.out" }, at(S, i === 0 ? 1.28 : 1.34 + (i - 1) * 0.04));
  });

  // ---- Summer, Turnover. A clean cut sweeps down to the stump and the leaves fall as slips. The old
  // chair line is struck through, the double rule closes the board year, the new chair is written
  // under it and five shoots regrow from the same roots. The rows above the rule stay.
  const U = 3;
  const rect = one(".ld-cut-rect");
  const line = one(".ld-cutline");
  tl.to(q(".ld-due"), { opacity: 0, duration: 0.1 }, at(U, 0));
  tl.to(q(".ld-claim-tags"), { opacity: 0, duration: 0.12 }, at(U, 0));
  tl.fromTo(q(".ld-chair-old"), { opacity: 0 }, { opacity: 1, duration: 0.1 }, at(U, 0.04));
  tl.fromTo(line, { y: -36, opacity: 0 }, { opacity: 1, duration: 0.05 }, at(U, 0));
  tl.to(line, { y: CUT_Y, duration: 0.5, ease: "power1.inOut" }, at(U, 0.02));
  tl.to(rect, { attr: { y: CUT_Y, height: 460 - CUT_Y }, duration: 0.5, ease: "power1.inOut" }, at(U, 0.02));
  tl.to(line, { opacity: 0, duration: 0.1 }, at(U, 0.52));
  el.querySelectorAll<SVGGElement>(".ld-slip").forEach((slip, i) => {
    const x = Number(slip.dataset.x);
    const y = Number(slip.dataset.y);
    const t = at(U, 0.02) + 0.5 * ((y + 36) / (CUT_Y + 36));
    tl.set(slip, { opacity: 0 }, 0);
    tl.set(slip, { opacity: 1, x, y, rotation: 0 }, t);
    tl.to(slip, { x: 500 + (i % 3) * 14, y: y + 110 + i * 5, rotation: (i % 2 ? 1 : -1) * (20 + i * 4), duration: 0.4, ease: "power1.in" }, t);
    tl.to(slip, { opacity: 0, duration: 0.1 }, t + 0.32);
  });
  tl.fromTo(q(".ld-chair-old .ld-pen"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.14, ease: "power2.out" }, at(U, 0.32));
  tl.fromTo(q(".ld-turnover-wrap"), { opacity: 0, scaleX: 0.2, transformOrigin: "0% 50%" }, { opacity: 1, scaleX: 1, duration: 0.3, ease: "power2.out" }, at(U, 0.5));
  beat(U, 0, at(U, 0.84));
  write(".ld-chair-ink", at(U, 0.86), 0.26);
  beat(U, 1, at(U, 1.14));
  grow("b", 5, at(U, 0.46), 0.07, 0.5);
  q(".ld-tag").forEach((tag, i) => {
    tl.fromTo(tag, { opacity: 0, rotation: i % 2 ? 9 : -9, transformOrigin: "50% 0%" }, { opacity: 1, rotation: 0, duration: 0.16, ease: "back.out(1.6)" }, at(U, 0.9 + i * 0.05));
  });
  beat(U, 2, at(U, 1.3));

  // ---- The queue. The book gives way to a framed render of the real queue page, which is fully
  // visible from 0.4 units into it and holds there to the end of the pin.
  tl.to(q(".ld-book"), { opacity: 0, scale: 0.97, duration: 0.3, ease: "power1.in" }, at(U, 1.5));
  tl.fromTo(q(".ld-frame"), { opacity: 0, y: 28, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power3.out" }, at(U, 1.7));

  // Keep the timeline exactly TOTAL units long, so the hold at the end is part of it.
  tl.to({}, { duration: 0.02 }, TOTAL - 0.02);
  return tl;
}
