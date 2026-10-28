"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { STAGE_LABELS } from "@/demo/types";
import { ClaimIcon, CompaniesIcon, BoardIcon, FactsIcon, ImportIcon, LogIcon, QueueIcon, SearchIcon, SettingsIcon, StageGlyph } from "../icons";
import { LogoMark } from "../logo";
import { Ribbon } from "../marks";
import { OverdueMark, overdueLevel } from "../screens/overdue";
import { MINI_NEVER, type MiniRow } from "./mini-data";

// A small queue built from the same pieces as the real one: the spine, the ruled table with its
// board-year margin, the overdue levels, the three claim states, the command palette as an index
// card, and the footer status line. The hero script owns the state and moves it; this file only
// draws it, so what you watch is real markup in the theme and not a picture.
//
// The whole window is decoration (aria-hidden). Nothing in it can take focus.

export type MiniState = {
  rows: MiniRow[];
  selectedId: string | null;
  // The row whose Claim button shows pressed for a moment.
  pressing: string | null;
  // The row whose ribbon should drop in (it has just been claimed).
  fresh: string | null;
  palette: { open: boolean; query: string };
  log: boolean;
  note: { text: string; open: boolean } | null;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

// ----- The window -----

export function MiniQueue({ state, children }: { state: MiniState; children?: ReactNode }) {
  const overdue = state.rows.filter((r) => r.days > 0).length;
  const week = state.rows.filter((r) => r.days <= 0 && r.days >= -7).length;
  const mine = state.rows.filter((r) => r.claim.kind === "mine").length;
  const total = 42;
  return (
    <div className="ldm" aria-hidden="true">
      <div className="ldm-spine">
        <LogoMark size={26} className="ldm-spine-logo" />
        {[QueueIcon, BoardIcon, CompaniesIcon, ImportIcon, FactsIcon, SettingsIcon].map((Icon, i) => (
          <span key={i} className="ldm-tab" data-active={i === 0}>
            <Icon size={17} />
          </span>
        ))}
      </div>
      <div className="ldm-page">
        <header className="ldm-head">
          <p className="ldm-title">Boilermaker Robotics Club, Volume 2026-27</p>
          <span className="ldm-search" data-mini="search">
            <SearchIcon size={16} />
            <span className="ldm-search-text">Search companies, people or actions</span>
            <span className="ldm-kbds">
              <kbd>/</kbd>
              <kbd>{"⌘K"}</kbd>
            </span>
          </span>
        </header>
        <div className="ldm-rule" />

        <p className="ldm-totals">
          <span>
            Overdue <b key={overdue} className="lg-count">{overdue}</b>
          </span>
          <span>
            Due this week <b key={week} className="lg-count">{week}</b>
          </span>
          <span>
            Held by you <b key={mine} className="lg-count">{mine}</b>
          </span>
          <span className="ldm-totals-never">
            Never contacted <b>{MINI_NEVER}</b>
          </span>
        </p>

        <div className="ldm-colhead lg-sc">
          <span className="ldm-c-margin">Board</span>
          <span className="ldm-c-od">Follow-up</span>
          <span className="ldm-c-name">Company</span>
          <span className="ldm-c-stage">Stage</span>
          <span className="ldm-c-claim">Claim</span>
        </div>

        <MiniRows state={state} />

        <div className="ldm-lane">
          {state.note && (
            <p className="ldm-note" data-open={state.note.open}>
              {state.note.text}
            </p>
          )}
        </div>

        <footer className="ldm-status lg-sc">
          <span>{total} companies</span>
          <span className="ldm-status-sep">&middot;</span>
          <span>{overdue} overdue</span>
          <span className="ldm-status-sep">&middot;</span>
          <span>claim window 14 days</span>
          <span className="ldm-status-sep ldm-status-extra">&middot;</span>
          <span className="ldm-status-extra">Officer view</span>
        </footer>
      </div>

      {state.palette.open && <MiniPalette state={state} />}
      {state.log && <MiniLog />}
      {children}
    </div>
  );
}

// ----- The rows -----

function MiniRows({ state }: { state: MiniState }) {
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const seen = useRef<Map<string, number>>(new Map());
  const order = state.rows.map((r) => r.id).join("|");
  const lastOrder = useRef(order);

  // FLIP: remember where each row was, read where it is now, and play the difference (a row that
  // moved up in the order slides up, the rows it passes slide down). The selection bar travels with it.
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const items = Array.from(ul.querySelectorAll<HTMLElement>("[data-flip]"));
    const next = new Map(items.map((el) => [el.dataset.flip as string, el.offsetTop]));
    const resorted = lastOrder.current !== order;
    lastOrder.current = order;
    if (resorted && !reducedMotion()) {
      let biggest: { el: HTMLElement; d: number } | null = null;
      for (const el of items) {
        const id = el.dataset.flip as string;
        const was = seen.current.get(id);
        const now = next.get(id);
        if (was === undefined || now === undefined || was === now) continue;
        const d = was - now;
        if (!biggest || Math.abs(d) > Math.abs(biggest.d)) biggest = { el, d };
        el.animate([{ transform: `translateY(${d}px)` }, { transform: "translateY(0)" }], { duration: 460, easing: EASE });
      }
      // The row that travels furthest passes over the others.
      if (biggest) {
        biggest.el.style.setProperty("z-index", "2");
        window.setTimeout(() => biggest?.el.style.removeProperty("z-index"), 470);
      }
    }
    seen.current = next;

    // One moss bar in the margin glides to the selected row (transform, 90 ms; as long as the re-sort when rows move).
    const b = bar.current;
    const sel = state.selectedId ? items.find((el) => el.dataset.flip === state.selectedId) : null;
    if (b) {
      if (sel) {
        b.style.setProperty("--ldm-dur", resorted && !reducedMotion() ? "460ms" : "90ms");
        b.style.setProperty("height", `${sel.offsetHeight}px`);
        b.style.setProperty("transform", `translateY(${sel.offsetTop}px)`);
        b.dataset.hidden = "false";
      } else {
        b.dataset.hidden = "true";
      }
    }
  }, [order, state.selectedId]);

  return (
    <div ref={list} className="ldm-rows">
      <span ref={bar} className="ldm-bar" data-hidden="true" />
      <ul>
        {state.rows.map((row) => (
          <MiniRowItem key={row.id} row={row} selected={row.id === state.selectedId} pressing={state.pressing === row.id} fresh={state.fresh === row.id} />
        ))}
      </ul>
    </div>
  );
}

function MiniRowItem({ row, selected, pressing, fresh }: { row: MiniRow; selected: boolean; pressing: boolean; fresh: boolean }) {
  const slot = useRef<HTMLSpanElement>(null);
  useWidthMorph(slot, row.claim.kind);
  const level = overdueLevel(row.days);
  return (
    <li className="ldm-row" data-flip={row.id} data-od={level} data-selected={selected}>
      <span className="ldm-margin lg-sc">26-27</span>
      <span className="ldm-od">
        <OverdueMark days={row.days} size={16} />
      </span>
      <span className="ldm-name">
        <StageGlyph stage={row.stage} size={13} className="ldm-name-glyph" />
        {row.name}
      </span>
      <span className="ldm-stage">
        <StageGlyph stage={row.stage} size={14} />
        {STAGE_LABELS[row.stage]}
      </span>
      <span ref={slot} className="ldm-claim">
        {row.claim.kind === "free" ? (
          <span className="ldm-chip ldm-chip-free" data-pressed={pressing} data-mini={`claim-${row.id}`}>
            Claim
          </span>
        ) : row.claim.kind === "mine" ? (
          <span className="ldm-chip ldm-chip-mine">
            <Ribbon size="sm" drop={fresh} className="ldm-chip-ribbon" />
            Yours until {row.claim.until}
          </span>
        ) : (
          <span className="ldm-chip ldm-chip-theirs">
            {row.claim.who} until {row.claim.until}
          </span>
        )}
      </span>
    </li>
  );
}

// The claim box morphs from the outlined button to the wider chip (a FLIP on width, 180 ms).
function useWidthMorph(ref: RefObject<HTMLElement | null>, key: string) {
  const width = useRef<number | null>(null);
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = el.getBoundingClientRect().width;
    const before = width.current;
    const changed = lastKey.current !== key;
    lastKey.current = key;
    width.current = next;
    if (!changed || before === null || Math.abs(before - next) < 2 || reducedMotion() || typeof el.animate !== "function") return;
    el.animate([{ width: `${before}px` }, { width: `${next}px` }], { duration: 180, easing: EASE });
  }, [key, ref]);
  useLayoutEffect(() => {
    if (ref.current) width.current = ref.current.getBoundingClientRect().width;
  });
}

// ----- The palette: an index card on paper -----

type Hit = { id: string; group: "Companies" | "Actions"; label: ReactNode; text: string; hint: string; stage?: MiniRow["stage"] };

function paletteHits(rows: MiniRow[], query: string): Hit[] {
  const lilly = rows.find((r) => r.id === "lilly");
  const all: Hit[] = [
    ...rows.map((r): Hit => ({ id: `c-${r.id}`, group: "Companies", label: r.name, text: r.name.toLowerCase(), hint: "matched on name", stage: r.stage })),
    ...rows
      .filter((r) => r.claim.kind === "free")
      .map((r): Hit => ({ id: `claim-${r.id}`, group: "Actions", label: `Claim ${r.name}`, text: `claim ${r.name.toLowerCase()}`, hint: "action" })),
    ...(lilly ? [{ id: "log-lilly", group: "Actions", label: "Log outreach on Eli Lilly", text: "log outreach on eli lilly", hint: "action" } as Hit] : []),
    { id: "go-board", group: "Actions", label: "Go to Board", text: "go to board", hint: "action" },
    { id: "go-queue", group: "Actions", label: "Go to Queue", text: "go to queue", hint: "action" },
  ];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...all.filter((h) => h.group === "Companies").slice(0, 2), ...all.filter((h) => h.id.startsWith("go-"))];
  return all.filter((h) => tokens.every((t) => h.text.includes(t))).slice(0, 4);
}

function MiniPalette({ state }: { state: MiniState }) {
  const hits = paletteHits(state.rows, state.palette.query);
  const groups = (["Companies", "Actions"] as const).map((g) => ({ g, items: hits.filter((h) => h.group === g) })).filter((x) => x.items.length > 0);
  return (
    <div className="ldm-scrim">
      <div className="ldm-pal">
        <div className="ldm-pal-field">
          <SearchIcon size={16} />
          <span className="ldm-pal-input" data-empty={state.palette.query === ""}>
            {state.palette.query || "Search companies, people or actions"}
            <span className="ldm-caret" />
          </span>
          <kbd>esc</kbd>
        </div>
        {groups.length === 0 ? (
          <p className="ldm-pal-none">No match.</p>
        ) : (
          groups.map(({ g, items }) => (
            <div key={g}>
              <p className="ldm-pal-group lg-sc">{g}</p>
              <ul>
                {items.map((h) => (
                  <li key={h.id} className="ldm-pal-item" data-active={h.id === hits[0].id}>
                    {h.stage ? <StageGlyph stage={h.stage} size={14} /> : <ClaimIcon size={15} />}
                    <span className="ldm-pal-label">{h.label}</span>
                    <span className="ldm-pal-hint">{h.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ----- The log form that the L key opens -----

function MiniLog() {
  return (
    <div className="ldm-log">
      <p className="ldm-log-title lg-sc">
        <LogIcon size={15} /> Log outreach on Eli Lilly
      </p>
      <div className="ldm-log-group">
        <span className="ldm-log-label">Channel</span>
        {["Email", "Call", "In person", "LinkedIn"].map((c, i) => (
          <span key={c} className="ldm-chipset" data-on={i === 0}>
            {c}
          </span>
        ))}
      </div>
      <div className="ldm-log-group">
        <span className="ldm-log-label">Follow up in</span>
        {["3 days", "7 days", "14 days"].map((c, i) => (
          <span key={c} className="ldm-chipset" data-on={i === 1}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

// ----- The pointer -----

export function MiniCursor() {
  return (
    <span className="ldm-cursor" data-cursor>
      <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true" focusable="false">
        <path d="M3 2v17l4.700-4.300 3.300 7.300 3-1.400-3.300-7.200 6.600-.4z" fill="var(--ink)" stroke="var(--paper)" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </span>
  );
}
