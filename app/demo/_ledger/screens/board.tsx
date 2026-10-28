"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import type { BoardColumn } from "@/demo/selectors";
import { demoRoutes, type BoardFilters } from "@/demo/routes";
import { useBoard, useBoardFilters } from "@/demo/store";
import { STAGE_LABELS, type Stage } from "@/demo/types";
import { CloseIcon, DuplicateIcon, PlusIcon, SearchIcon, StageGlyph } from "../icons";
import { useMoveStage } from "../providers";
import { useBoardDrag } from "./board-drag";
import { ArchivedSheet, DuplicatesSheet } from "./board-sheets";
import { Slip } from "./board-slip";
import { LedgerMenu, type MenuOption } from "./ledger-menu";
import { MoveMenu } from "./move-menu";
import { Count, Empty, useClaimAction, useFlash } from "./shared";

// The board. It fits the viewport: five ruled columns side by side (the last one holds Committed over
// Declined) and each column scrolls on its own. The row of stage names across the top is a station
// strip: every station shows its glyph, its name and its count, and pressing one shows only that
// stage (press it again to clear). Slips move three ways: drag one onto another stage, press its
// stage glyph button for a one-click Move to menu, or press m while it has focus. Look-alike and
// archived companies sit in two sheets behind the toolbar. Search and industry live in the URL.

const GROUPS: readonly (readonly Stage[])[] = [["NOT_CONTACTED"], ["CONTACTED"], ["REPLIED"], ["IN_CONVERSATION"], ["COMMITTED", "DECLINED"]];
// Both outcomes are always open on this board: the split column keeps them readable.
const OPEN_BOTH: Stage[] = ["COMMITTED", "DECLINED"];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Menu = { id: string; anchor: HTMLButtonElement };
type Landing = { id: string; stage: Stage; rect: DOMRect; focus: boolean };

export function BoardScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const urlFilters = useBoardFilters();
  const filters = useMemo<BoardFilters>(() => ({ ...urlFilters, show: OPEN_BOTH }), [urlFilters]);
  const board = useBoard(ws, filters);
  const moveStage = useMoveStage();
  const { flashing, flash } = useFlash();
  const claimAction = useClaimAction(ws, flash);
  const [q, setQ] = useState(urlFilters.q);
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const timer = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const landing = useRef<Landing | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The URL is the source of truth for the query: when the palette or the Back button changes it, the box follows.
  const [seenQ, setSeenQ] = useState(urlFilters.q);
  if (seenQ !== urlFilters.q) {
    setSeenQ(urlFilters.q);
    if (q.trim() !== urlFilters.q) setQ(urlFilters.q);
  }

  const go = (patch: Partial<BoardFilters>) => {
    startTransition(() => router.replace(demoRoutes.board(ws, { ...urlFilters, ...patch }), { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go({ q: value.trim().slice(0, 100), all: null }), 300);
  };

  const byStage = useMemo(() => new Map(board.columns.map((c) => [c.stage, c] as const)), [board.columns]);
  const cardOf = (id: string) => board.columns.flatMap((c) => c.cards).find((x) => x.company.id === id);

  // Moving a slip: the shared service asks first for Committed and Declined and asks which outreach
  // got the reply for Replied and later. Once it moves, the slip glides from where it was to its new column.
  const requestMove = (id: string, to: Stage, from: DOMRect, focus: boolean) => {
    const card = cardOf(id);
    if (!card) return;
    setMoveErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    landing.current = { id, stage: card.company.stage, rect: from, focus };
    void moveStage({
      ws,
      companyId: id,
      companyName: card.company.name,
      to,
      onError: (message) => setMoveErrors((current) => ({ ...current, [id]: message })),
    }).then((moved) => {
      if (moved) flash(id);
      else if (landing.current?.id === id) landing.current = null;
    });
  };

  const drag = useBoardDrag({ scroller, onDrop: (id, to, from) => requestMove(id, to, from, false) });

  useLayoutEffect(() => {
    const land = landing.current;
    if (!land) return;
    const el = document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(land.id)}"]`);
    if (!el || el.dataset.stage === land.stage) return;
    landing.current = null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (land.focus) el.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    if (reducedMotion() || typeof el.animate !== "function") return;
    const to = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${land.rect.left - to.left}px, ${land.rect.top - to.top}px)` }, { transform: "translate(0, 0)" }], {
      duration: 220,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
  }, [board]);

  const openMenu = (id: string, anchor: HTMLButtonElement) => setMenu((current) => (current?.id === id ? null : { id, anchor }));
  const menuCard = menu ? cardOf(menu.id) : undefined;

  const toggleStage = (stage: Stage) => go({ stage: urlFilters.stage === stage ? null : stage, all: null });
  const filtered = Boolean(urlFilters.q || urlFilters.industry);
  const loading = pending || q.trim() !== urlFilters.q;

  const industryOptions: MenuOption<string>[] = [{ value: "", label: "All industries" }, ...board.industries.map((i) => ({ value: i, label: i }))];

  const renderStage = (col: BoardColumn) => {
    const focus = urlFilters.stage;
    const rail = focus !== null && focus !== col.stage;
    return (
      <div key={col.stage} className="lg-bstage" data-drop-stage={col.stage} data-state={rail ? "rail" : focus ? "focus" : undefined} data-over={drag.over === col.stage || undefined}>
        <h2 className="lg-st-h">
          <button
            type="button"
            className="lg-st"
            aria-pressed={focus === col.stage}
            title={focus === col.stage ? "Show every stage again" : `Show only ${col.label}`}
            onClick={() => toggleStage(col.stage)}
          >
            <span className="lg-st-dot">
              <StageGlyph stage={col.stage} size={16} />
            </span>
            <span className="lg-st-name lg-sc">{col.label}</span>
            <span className="lg-st-n">
              <Count value={col.count} />
              <span className="lg-sr"> {col.count === 1 ? "company" : "companies"}</span>
            </span>
          </button>
        </h2>
        {!rail && (
          <div className="lg-bbody">
            <ul className="lg-slips" aria-label={`${col.label}, ${col.count}`}>
              {drag.over === col.stage && (
                <li className="lg-dropline" aria-hidden="true">
                  <span className="lg-sc">Move to {col.label}</span>
                </li>
              )}
              {col.cards.map((card) => (
                <Slip
                  key={card.company.id}
                  ws={ws}
                  card={card}
                  shaking={claimAction.shaking === card.company.id}
                  flashing={flashing.has(card.company.id)}
                  lifted={drag.dragging === card.company.id}
                  error={claimAction.errors[card.company.id] ?? moveErrors[card.company.id]}
                  menuOpen={menu?.id === card.company.id}
                  onClaim={() => claimAction.claim(card.company.id, card.company.name)}
                  onDismiss={() => {
                    claimAction.dismiss(card.company.id);
                    setMoveErrors((current) => {
                      const next = { ...current };
                      delete next[card.company.id];
                      return next;
                    });
                  }}
                  onOpenMenu={(button) => openMenu(card.company.id, button)}
                  onPointerDown={drag.onPointerDown}
                />
              ))}
            </ul>
            {col.cards.length === 0 && !drag.dragging && <p className="lg-colempty">Nothing in this stage.</p>}
            {col.hasMore && (
              <p className="lg-colmore">
                <Link href={demoRoutes.board(ws, { ...urlFilters, all: col.stage })} className="lg-link" scroll={false}>
                  Show all {col.count}
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="lg-board">
      <div className="lg-btop">
        <h1 className="lg-h1 lg-btop-title">
          Board{" "}
          <span className="lg-h1-count">
            <Count value={board.total} />
          </span>
        </h1>
        <form className="lg-bsearch" role="search" onSubmit={(e) => e.preventDefault()}>
          <SearchIcon size={18} />
          <label className="lg-sr" htmlFor="company-search">
            Search companies
          </label>
          <input id="company-search" type="search" className="lg-input" placeholder="Search companies" maxLength={100} value={q} onChange={(e) => onSearch(e.target.value)} />
        </form>
        <LedgerMenu label="Industry" value={urlFilters.industry} options={industryOptions} onChange={(industry) => go({ industry, all: null })} />
        {urlFilters.stage && (
          <button type="button" className="lg-fchip" onClick={() => go({ stage: null, all: null })}>
            <span>Only {STAGE_LABELS[urlFilters.stage]}</span>
            <CloseIcon size={14} />
            <span className="lg-sr">Show every stage again</span>
          </button>
        )}
        <div role="status" aria-live="polite" className="lg-btop-status">
          {loading && <p className="lg-muted lg-loading">Loading...</p>}
        </div>
        <div className="lg-btools-end">
          <button type="button" className="lg-toggle" aria-haspopup="dialog" aria-expanded={urlFilters.dupes} onClick={() => go({ dupes: !urlFilters.dupes, archived: false })}>
            <DuplicateIcon size={16} />
            <span>
              Possible duplicates <span className="lg-num">{board.duplicatePairsCapped ? "50+" : board.duplicatePairs.length}</span>
            </span>
          </button>
          <button type="button" className="lg-toggle" aria-haspopup="dialog" aria-expanded={urlFilters.archived} onClick={() => go({ archived: !urlFilters.archived, dupes: false })}>
            <span>
              Archived <span className="lg-num">{board.archivedCount}</span>
            </span>
          </button>
        </div>
        <Link href={demoRoutes.newCompany(ws)} className="lg-btn lg-btn-primary lg-btop-add">
          <PlusIcon size={16} />
          Add company
        </Link>
      </div>

      {board.total === 0 ? (
        <Empty kind="board">
          <p className="lg-empty-title">{filtered ? "No companies match." : "No companies yet."}</p>
          {!filtered && (
            <p>
              <Link href={demoRoutes.newCompany(ws)} className="lg-link">
                Add your first one.
              </Link>
            </p>
          )}
        </Empty>
      ) : (
        <>
          <p className="lg-bhint lg-muted">Drag a slip to another stage, or press m on one. The glyph on a slip opens the same menu.</p>
          <div
            ref={scroller}
            className="lg-bd"
            role="region"
            aria-label="Pipeline, one column per stage"
            data-focus={urlFilters.stage ?? undefined}
            data-dragging={drag.dragging ? "" : undefined}
          >
            {GROUPS.map((group) => {
              const cols = group.map((stage) => byStage.get(stage) as BoardColumn);
              const allRail = urlFilters.stage !== null && !group.includes(urlFilters.stage);
              return (
                <section
                  key={group.join("-")}
                  className="lg-bcol"
                  data-split={group.length > 1 || undefined}
                  data-rail={allRail || undefined}
                  aria-label={group.map((s) => STAGE_LABELS[s]).join(" and ")}
                >
                  {cols.map(renderStage)}
                </section>
              );
            })}
          </div>
        </>
      )}

      {menu && menuCard && (
        <MoveMenu
          anchor={menu.anchor}
          companyName={menuCard.company.name}
          current={menuCard.company.stage}
          onClose={(restore) => {
            setMenu(null);
            if (restore) menu.anchor.focus();
          }}
          onPick={(stage) => {
            const from = (menu.anchor.closest("[data-slip]") as HTMLElement | null)?.getBoundingClientRect() ?? menu.anchor.getBoundingClientRect();
            setMenu(null);
            requestMove(menu.id, stage, from, true);
          }}
        />
      )}

      {urlFilters.dupes && <DuplicatesSheet ws={ws} pairs={board.duplicatePairs} capped={board.duplicatePairsCapped} onClose={() => go({ dupes: false })} />}
      {urlFilters.archived && <ArchivedSheet ws={ws} count={board.archivedCount} list={board.archived} onClose={() => go({ archived: false })} />}
    </div>
  );
}
