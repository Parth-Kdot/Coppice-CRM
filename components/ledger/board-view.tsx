"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type FocusEvent, type KeyboardEvent } from "react";
import { moveStage, releaseClaim } from "@/app/(app)/[workspaceId]/companies/actions";
import { BoardSearch } from "@/components/board-search";
import type { Stage } from "@/generated/prisma/enums";
import { closeQuestion, STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { ReplyChoice } from "@/lib/companies";
import type { BoardFilters } from "@/lib/validation";
import { useBoardDrag } from "./board-drag";
import { inBoardView, rove, settleRoving, SLIP_LINK, slipOf, stripButton } from "./board-dom";
import { ShortcutsDialog } from "./board-shortcuts";
import { Slip, type BoardCardData } from "./board-slip";
import { BoardStrip, GROUPS } from "./board-strip";
import { focusSoon } from "./focus";
import { completeStamp, prefersReducedMotion, preloadMotion, restore, sendTo } from "./motion-kit";
import { CloseIcon, ImportIcon, PlusIcon, StageGlyph } from "./icons";
import { MoveMenu, type MoveMenuAction } from "./move-menu";
import { OverflowMenu, type OverflowItem } from "./overflow-menu";
import { useConfirm, useNotify } from "./providers";
import { ReplyPrompt } from "./reply-prompt";
import { Count, Empty } from "./shared";
import { MoreLink } from "./show-more";
import "./board.css";

// The board. It fits the viewport: five ruled columns side by side (the last one holds Committed over
// Declined), each scrolling on its own and showing 50 slips, then "Show 50 more" up to 200. Each
// column head shows its glyph, the stage's name and its count; pressing one shows only that stage (press it again to clear). Slips move
// three ways: drag one onto another stage, its stage glyph button (the slip's menu: Move to, Claim,
// Release), or m while it has focus. All three call the real stage action; a refusal is written in
// the slip's margin, and an officer never gets stage choices on a slip someone else holds (the menu
// says who holds it; the server still checks). A move into a reply stage then asks which outreach
// got the reply (ReplyPrompt). A slip just moved stays in sight in its new column even when it sorts
// past the 50 shown, marked "Just moved", until the next full load. Motion only marks the move
// itself (the slip flies to its column and settles with a stamp, components/ledger/motion-kit.ts).
//
// Above the board: the title and count, search, the industry filter (only with 10 or more
// companies), the More menu (look-alikes, archived, template stats, keyboard shortcuts) and Add
// company. On a phone a sticky strip of stages jumps between columns. An empty workspace shows only
// the way in: Import and Add a company.

export type BoardColumnData = { stage: Stage; count: number; shown: number; moreHref: string; cards: BoardCardData[] };

const FILTER_FROM = 10;

type Menu = { id: string; anchor: HTMLButtonElement };
// A move on its way: `flew` when the slip flew there (menu, keyboard) rather than being dropped;
// `away` when its new column is out of view (a phone shows one column), so the board stays put.
type Landing = { id: string; from: Stage; to: Stage; rect: DOMRect; focus: boolean; flew: boolean; away: boolean };

type Props = {
  workspaceId: string;
  isOwner: boolean;
  columns: BoardColumnData[];
  filters: BoardFilters;
  industries: string[];
  total: number;
  workspaceTotal: number;
  filtered: boolean;
  duplicateCount: number;
  duplicateLabel: string;
  archivedCount: number;
  dupesHref: string;
  archivedHref: string;
};

export function BoardView(props: Props) {
  const {
    workspaceId,
    isOwner,
    columns,
    filters,
    industries,
    total,
    workspaceTotal,
    filtered,
    duplicateCount,
    duplicateLabel,
    archivedCount,
    dupesHref,
    archivedHref,
  } = props;
  const notify = useNotify();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [only, setOnly] = useState<Stage | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [replyAsk, setReplyAsk] = useState<{ id: string; name: string; choices: ReplyChoice[] } | null>(null);
  const [slipErrors, setSlipErrors] = useState<Record<string, string>>({});
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  // Slips moved here that the server's page of 50 doesn't include: drawn at the top of their new
  // column until the next full load (or until the server's page has them).
  const [pins, setPins] = useState<ReadonlyMap<string, BoardCardData>>(new Map());
  // Moves the server's page hasn't caught up with yet, by id, with the stage each left: their pin
  // wins over where the server's page has them. One leaves the map once the server's page no longer
  // lists it in its old column (the fresh board after the action), or when the move is refused.
  const [moving, setMoving] = useState<ReadonlyMap<string, Stage>>(new Map());
  const caughtUp = [...moving].filter(([id, from]) => !columns.some((c) => c.stage === from && c.cards.some((card) => card.id === id)));
  if (caughtUp.length > 0) {
    const next = new Map(moving);
    for (const [id] of caughtUp) next.delete(id);
    setMoving(next);
  }
  const [shortcuts, setShortcuts] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const landing = useRef<Landing | null>(null);
  const flashTimers = useRef<Set<number>>(new Set());

  // A new search or filter is a new board: drop the pins and the "only" state with it.
  const [seenFilters, setSeenFilters] = useState(filters);
  if (seenFilters.q !== filters.q || seenFilters.industry !== filters.industry) {
    setSeenFilters(filters);
    setPins(new Map());
  }

  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  // The columns as drawn. A slip moved here is pinned at the top of its new column until the next
  // full load (or a new search), with the server's fresh data once its page has it, so it never
  // jumps away from where the person watched it land. While a move is unanswered its pin wins over
  // the server's page; once answered, if the server has it somewhere else, the server wins.
  const shown = useMemo(() => {
    const server = new Map(columns.flatMap((c) => c.cards.map((card) => [card.id, card] as const)));
    const top = new Map<string, BoardCardData>();
    for (const pin of pins.values()) {
      const there = server.get(pin.id);
      if (moving.has(pin.id) || !there) top.set(pin.id, pin);
      else if (there.stage === pin.stage) top.set(pin.id, { ...there, justMoved: true });
    }
    if (top.size === 0 && moving.size === 0) return columns;
    // A move the server's page hasn't caught up with counts in its new column already, not its old.
    const delta = new Map<Stage, number>();
    for (const [id, from] of moving) {
      const to = pins.get(id)?.stage;
      if (!to || to === from) continue;
      delta.set(from, (delta.get(from) ?? 0) - 1);
      delta.set(to, (delta.get(to) ?? 0) + 1);
    }
    return columns.map((col) => ({
      ...col,
      count: Math.max(0, col.count + (delta.get(col.stage) ?? 0)),
      cards: [...[...top.values()].filter((card) => card.stage === col.stage), ...col.cards.filter((card) => !top.has(card.id) && !moving.has(card.id))],
    }));
  }, [columns, pins, moving]);
  const byStage = useMemo(() => new Map(shown.map((c) => [c.stage, c] as const)), [shown]);
  const latest = useRef({ shown, isOwner });
  useEffect(() => {
    latest.current = { shown, isOwner };
  });
  const cardOf = (id: string) => latest.current.shown.flatMap((c) => c.cards).find((card) => card.id === id);

  const flash = (id: string) => {
    setFlashing((current) => new Set(current).add(id));
    const timer = window.setTimeout(() => {
      flashTimers.current.delete(timer);
      setFlashing((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, 700);
    flashTimers.current.add(timer);
  };

  const clearSlipError = useCallback(
    (id: string) =>
      setSlipErrors((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }),
    [],
  );

  // "See it" after a move to a column out of view: the board scrolls there (smoothly, unless motion
  // is reduced; the strip marks the column as it arrives) and the slip takes focus and its stamp.
  const seeIt = (id: string, stage: Stage) => {
    const el = slipOf(id);
    const col = (el ?? document.querySelector(`[data-stage-head="${stage}"]`))?.closest<HTMLElement>(".lg-bcol");
    const root = scroller.current;
    if (!root || !col) return;
    const still = prefersReducedMotion();
    root.scrollTo({ left: col.offsetLeft, behavior: still ? "auto" : "smooth" });
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still ? "auto" : "smooth" });
    const link = el?.querySelector<HTMLElement>(SLIP_LINK);
    if (link) {
      rove(link);
      link.focus({ preventScroll: true });
    }
    window.setTimeout(() => void completeStamp(slipOf(id)), still ? 0 : 320);
  };

  // Moving a slip calls the real stage action with the same form fields as the stage form. Committed
  // and Declined ask first, because they close the pitch and release any claim. From the menu or the
  // keyboard the slip flies to its new column's head (the motion kit's sendTo) while the server
  // works; a dropped slip is already where the person let go. Either way it is then drawn in its new
  // column at once (optimistically, until the server answers) and settles there with a stamp. It
  // stays pinned at the top of that column, so it can't vanish when it sorts past the 50 shown. A
  // refusal puts it back where it was and writes the reason in its margin.
  const requestMove = async (id: string, to: Stage, from: DOMRect, focus: boolean, dropped = false) => {
    const card = cardOf(id);
    if (!card || card.stage === to) return;
    clearSlipError(id);
    if (TERMINAL_STAGES.includes(to)) {
      const ok = await confirm(closeQuestion(card.name, to));
      if (!ok) {
        if (focus) focusSoon(() => document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(id)}"] ${SLIP_LINK}`));
        return;
      }
    }
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("companyId", id);
    form.set("stage", to);
    const closes = TERMINAL_STAGES.includes(to);
    const previousPin = pins.get(id);
    const slip = slipOf(id);
    // The new column's head, or on a phone, where that column is out of view, its button in the
    // stage strip: the slip flies there and the board stays on the column the person is working
    // through (a note offers "See it"). Focus stays in this column, on the next slip.
    const head = document.querySelector<HTMLElement>(`[data-stage-head="${to}"]`);
    const away = !dropped && !!head && !inBoardView(head, scroller.current);
    const strip = away ? stripButton(to) : null;
    const nextHere = away && focus && slip ? ((slip.nextElementSibling ?? slip.previousElementSibling)?.querySelector<HTMLElement>(SLIP_LINK) ?? null) : null;
    landing.current = { id, from: card.stage, to, rect: from, focus: focus && !away, flew: !dropped, away };
    // Drawn in the new column, with both counts updated, as the flight reaches it (a drop: right
    // away), without waiting on the server. An urgent update, outside the transition below, so it
    // paints at once.
    const place = () => {
      setPins((current) =>
        new Map(current).set(id, {
          ...card,
          stage: to,
          closed: closes,
          justMoved: true,
          claim: closes ? { state: "free", holderName: null, until: null } : card.claim,
        }),
      );
      setMoving((current) => new Map(current).set(id, card.stage));
    };
    const moved = dropped ? Promise.resolve().then(place) : sendTo(slip, away ? (strip && strip.offsetParent ? strip : null) : head, { collapse: "height", focus: nextHere, arrived: place });
    if (away && focus && !nextHere) focusSoon(`[data-stage-head="${card.stage}"]`);
    startTransition(async () => {
      // Waits for the flight too, so a refusal never lands before the slip it puts back.
      const [result] = await Promise.all([moveStage(null, form), moved]);
      if (result.ok) {
        flash(id);
        if (away) notify(`Moved ${card.name} to ${STAGE_LABELS[to]}.`, "ok", { action: { label: "See it", onSelect: () => seeIt(id, to) } });
        else notify(`Moved ${card.name} to ${STAGE_LABELS[to]}.`);
        if (result.data?.replyChoices) setReplyAsk({ id, name: card.name, choices: result.data.replyChoices });
      } else {
        if (landing.current?.id === id) landing.current = null;
        restore(slip);
        setMoving((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        setPins((current) => {
          const next = new Map(current);
          if (previousPin) next.set(id, previousPin);
          else next.delete(id);
          return next;
        });
        setSlipErrors((current) => ({ ...current, [id]: result.error }));
        if (focus) focusSoon(() => slipOf(id)?.querySelector<HTMLElement>(SLIP_LINK) ?? null);
      }
    });
  };
  const moveRef = useRef(requestMove);
  useEffect(() => {
    moveRef.current = requestMove;
  });

  const drag = useBoardDrag({ scroller, onDrop: (id, to, from) => void moveRef.current(id, to, from, false, true) });

  // Once the moved slip is drawn in its new column it settles there with a stamp and, when the move
  // came from the keyboard, takes focus. A dropped slip first glides from where it was let go. If it
  // can't be found (a search hides it now), focus goes to its new column's head, never to <body>.
  useLayoutEffect(() => {
    settleRoving(scroller.current);
    const land = landing.current;
    if (!land) return;
    const el = document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(land.id)}"]`);
    if (el && el.dataset.stage !== land.to) return; // still in the old column: in flight
    if (!el) {
      // Waiting while the old column still lists it.
      const stale = latest.current.shown.some((c) => c.stage === land.from && c.cards.some((card) => card.id === land.id));
      if (stale) return;
      landing.current = null;
      if (land.focus) focusSoon(`[data-stage-head="${land.to}"]`);
      return;
    }
    landing.current = null;
    // Out of view on a phone: the board stays where it is; "See it" in the note goes there.
    if (land.away) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const link = el.querySelector<HTMLElement>(SLIP_LINK);
    if (land.focus && link) {
      rove(link);
      link.focus({ preventScroll: true });
    }
    if (land.flew || prefersReducedMotion() || typeof el.animate !== "function") {
      void completeStamp(el);
      return;
    }
    const to = el.getBoundingClientRect();
    const glide = el.animate([{ transform: `translate(${land.rect.left - to.left}px, ${land.rect.top - to.top}px)` }, { transform: "translate(0, 0)" }], {
      duration: 180,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
    glide.finished.then(
      () => void completeStamp(el),
      () => undefined,
    );
  }, [shown, only]);

  // Opening a slip's menu usually means a move is next: start loading the motion kit's engine
  // (never under reduced motion, where no move plays).
  const openMenu = useCallback((id: string, anchor: HTMLButtonElement) => {
    if (!prefersReducedMotion()) preloadMotion();
    setMenu((current) => (current?.id === id ? null : { id, anchor }));
  }, []);
  // Escape hands focus back to the slip itself (its link is the column's tab stop), not to the glyph
  // button, which is out of the tab order.
  const closeMenu = useCallback((restore: boolean, anchor: HTMLButtonElement) => {
    setMenu(null);
    if (!restore) return;
    const link = anchor.closest("[data-slip]")?.querySelector<HTMLElement>(SLIP_LINK);
    if (link) {
      rove(link);
      link.focus();
    } else anchor.focus();
  }, []);
  const menuCard = menu ? shown.flatMap((c) => c.cards).find((card) => card.id === menu.id) : undefined;

  const claim = (id: string) => slipOf(id)?.querySelector<HTMLFormElement>("form[data-claim-form]")?.requestSubmit();
  const release = (card: BoardCardData) => {
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("companyId", card.id);
    startTransition(async () => {
      const result = await releaseClaim(null, form);
      if (result.ok) notify(`Released ${card.name}.`);
      else setSlipErrors((current) => ({ ...current, [card.id]: result.error }));
    });
  };

  const menuActions = (card: BoardCardData): MoveMenuAction[] => {
    if (card.closed) return [];
    const focusSlip = () => focusSoon(() => slipOf(card.id)?.querySelector<HTMLElement>(SLIP_LINK) ?? null);
    if (card.claim.state === "free" || card.claim.state === "expired")
      return [
        {
          key: "claim",
          label: "Claim",
          onSelect: () => {
            setMenu(null);
            focusSlip();
            claim(card.id);
          },
        },
      ];
    if (card.claim.state === "mine")
      return [
        {
          key: "release",
          label: "Release your claim",
          onSelect: () => {
            setMenu(null);
            focusSlip();
            release(card);
          },
        },
      ];
    return [];
  };

  // Keys on a focused slip: arrows move between slips (Up, Down) and columns (Left, Right), Home and
  // End go to the ends of a column, m opens the slip's menu and c claims it.
  const onBoardKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(SLIP_LINK) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const slip = target.closest<HTMLElement>("[data-slip]");
    const list = target.closest("ul");
    if (!slip || !list) return;
    const links = [...list.querySelectorAll<HTMLElement>(SLIP_LINK)];
    const at = links.indexOf(target);
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      event.preventDefault();
      rove(el);
      el.focus();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const key = event.key;
    switch (key) {
      case "ArrowDown":
        return go(links[at + 1]);
      case "ArrowUp":
        return go(links[at - 1]);
      case "Home":
        return go(links[0]);
      case "End":
        return go(links[links.length - 1]);
      case "ArrowLeft":
      case "ArrowRight": {
        const lists = [...(scroller.current?.querySelectorAll("ul.lg-slips") ?? [])].filter((ul) => ul.querySelector(SLIP_LINK));
        const here = lists.indexOf(list);
        const next = lists[here + (key === "ArrowRight" ? 1 : -1)];
        if (!next) return;
        const nextLinks = [...next.querySelectorAll<HTMLElement>(SLIP_LINK)];
        return go(nextLinks[Math.min(at, nextLinks.length - 1)]);
      }
      case "m": {
        const button = slip.querySelector<HTMLButtonElement>("[data-move-button]");
        if (!button) return;
        event.preventDefault();
        openMenu(slip.dataset.slip as string, button);
        return;
      }
      case "c": {
        const card = cardOf(slip.dataset.slip as string);
        if (!card) return;
        event.preventDefault();
        if (card.closed) notify(`${card.name} is ${STAGE_LABELS[card.stage]}, so it can't be claimed.`, "error");
        else if (card.claim.state === "mine") notify(`You already hold ${card.name}.`);
        else if (card.claim.state === "theirs") notify(`${card.claim.holderName ?? "Someone"} holds ${card.name} until ${card.claim.until}.`, "error");
        else claim(card.id);
        return;
      }
    }
  };

  const onBoardFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches(SLIP_LINK)) rove(target);
  };

  const renderStage = (col: BoardColumnData) => {
    const rail = only !== null && only !== col.stage;
    const focused = only === col.stage;
    const label = STAGE_LABELS[col.stage];
    const unit = col.count === 1 ? "company" : "companies";
    return (
      <div key={col.stage} className="lg-bstage" data-drop-stage={col.stage} data-state={rail ? "rail" : only ? "focus" : undefined}>
        <h2 className="lg-st-h">
          <button
            type="button"
            className="lg-st"
            data-stage-head={col.stage}
            aria-pressed={focused}
            title={
              focused
                ? `Showing only ${label}. Press to show every stage again.`
                : `${label}: ${col.count.toLocaleString("en-US")} ${unit}. Press to show only this stage.`
            }
            onClick={() => setOnly(focused ? null : col.stage)}
          >
            <span className="lg-st-dot">
              <StageGlyph stage={col.stage} size={16} />
            </span>
            <span className="lg-st-name">{label}</span>
            <span className="lg-st-n">
              <Count value={col.count} />
              <span className="lg-sr"> {unit}</span>
            </span>
            {focused && (
              <span className="lg-st-clear" aria-hidden="true">
                <CloseIcon size={14} />
              </span>
            )}
          </button>
        </h2>
        {!rail && (
          <div className="lg-bbody">
            <ul className="lg-slips" aria-label={`${label}, ${col.count}`} data-drop-label={label}>
              {col.cards.map((card) => (
                <Slip
                  key={card.id}
                  workspaceId={workspaceId}
                  card={card}
                  flashing={flashing.has(card.id)}
                  menuOpen={menu?.id === card.id}
                  locked={!isOwner && card.claim.state === "theirs"}
                  error={slipErrors[card.id]}
                  onDismissError={clearSlipError}
                  onOpenMenu={openMenu}
                  onPointerDown={drag.onPointerDown}
                />
              ))}
            </ul>
            {col.cards.length === 0 && <p className="lg-colempty">Nothing here.</p>}
            <div className="lg-colmore">
              <MoreLink href={col.moreHref} shown={col.shown} total={col.count} />
            </div>
          </div>
        )}
      </div>
    );
  };

  const moreItems: OverflowItem[] = [
    ...(duplicateCount > 0 ? [{ key: "dupes", label: `Possible duplicates (${duplicateLabel})`, href: dupesHref }] : []),
    ...(archivedCount > 0 ? [{ key: "archived", label: `Archived (${archivedCount.toLocaleString("en-US")})`, href: archivedHref }] : []),
    { key: "stats", label: "Template stats", href: `/${workspaceId}/stats` },
    ...(workspaceTotal > 0 ? [{ key: "keys", label: "Keyboard shortcuts", onSelect: () => setShortcuts(true) }] : []),
  ];
  const empty = workspaceTotal === 0;
  const moreLabel = `More board actions${duplicateCount > 0 ? `, ${duplicateLabel} possible duplicates to review` : ""}`;
  // The end of the toolbar: the ⋯ menu and Add a company. BoardSearch draws it (so that on a phone
  // the industry filter can be a choice in the menu) and hands over those items, and a note for
  // the menu button's name while an industry filter is on.
  const renderEnd = ({ items, note }: { items: OverflowItem[]; note: string }) => (
    <div className="lg-btools-end">
      {(!empty || archivedCount > 0) && (
        <span className="lg-bmore" data-badge={duplicateCount > 0 || undefined}>
          <OverflowMenu label={note ? `${moreLabel}, ${note}` : moreLabel} items={[...moreItems, ...items]} data-tour="board-more" />
          {duplicateCount > 0 && <span className="lg-bmore-badge" aria-hidden="true" title={`${duplicateLabel} possible duplicates to review, under More`} />}
        </span>
      )}
      {!empty && (
        <Link href={`/${workspaceId}/companies/new`} className="lg-btn lg-btn-primary lg-btop-add" aria-label="Add a company">
          <PlusIcon size={16} />
          <span className="lg-btop-addword">Add a company</span>
        </Link>
      )}
    </div>
  );

  return (
    <div className="lg-board" data-empty={empty || undefined}>
      <div className="lg-btop">
        <h1 className="lg-h1 lg-btop-title" tabIndex={-1}>
          Board{" "}
          {!empty && (
            <span className="lg-h1-count">
              <Count value={total} />
            </span>
          )}
        </h1>
        {!empty && <BoardSearch filters={filters} industries={industries} showFilter={workspaceTotal >= FILTER_FROM || filters.industry !== ""} renderEnd={renderEnd} />}
        {empty && renderEnd({ items: [], note: "" })}
      </div>

      {empty ? (
        <Empty kind="board">
          <p className="lg-empty-title">No companies yet.</p>
          <p>Bring in your list from a spreadsheet, or add companies one at a time.</p>
          <p className="lg-empty-acts">
            <Link href={`/${workspaceId}/import`} className="lg-btn">
              <ImportIcon size={16} />
              Import a spreadsheet
            </Link>
            <Link href={`/${workspaceId}/companies/new`} className="lg-btn lg-btn-primary">
              <PlusIcon size={16} />
              Add a company
            </Link>
          </p>
        </Empty>
      ) : total === 0 && filtered ? (
        <Empty kind="board-filtered">
          <p className="lg-empty-title">No companies match.</p>
          <p>
            <Link href={`/${workspaceId}/board`} className="lg-link">
              Clear the search and filter
            </Link>
          </p>
        </Empty>
      ) : (
        <>
          <BoardStrip scroller={scroller} counts={GROUPS.map((group) => group.reduce((sum, s) => sum + (byStage.get(s)?.count ?? 0), 0))} />
          <div
            ref={scroller}
            className="lg-bd"
            role="region"
            aria-label="Pipeline, one column per stage"
            data-tour="board-columns"
            data-focus={only ?? undefined}
            onKeyDown={onBoardKey}
            onFocus={onBoardFocus}
          >
            {GROUPS.map((group) => {
              const cols = group.map((stage) => byStage.get(stage) as BoardColumnData);
              const allRail = only !== null && !group.includes(only);
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
          companyName={menuCard.name}
          current={menuCard.stage}
          disabledReason={
            !isOwner && menuCard.claim.state === "theirs" ? `Held by ${menuCard.claim.holderName ?? "someone else"} until ${menuCard.claim.until}` : undefined
          }
          actions={menuActions(menuCard)}
          onClose={(restore) => closeMenu(restore, menu.anchor)}
          onPick={(stage) => {
            const slip = menu.anchor.closest<HTMLElement>("[data-slip]");
            const from = slip?.getBoundingClientRect() ?? menu.anchor.getBoundingClientRect();
            // Hold focus on the slip while the move runs; it follows the slip once it lands.
            slip?.querySelector<HTMLElement>(SLIP_LINK)?.focus({ preventScroll: true });
            setMenu(null);
            void requestMove(menu.id, stage, from, true);
          }}
        />
      )}

      {replyAsk && (
        <ReplyPrompt
          workspaceId={workspaceId}
          companyId={replyAsk.id}
          companyName={replyAsk.name}
          choices={replyAsk.choices}
          onDone={() => setReplyAsk(null)}
          returnFocus={() => slipOf(replyAsk.id)?.querySelector<HTMLElement>(SLIP_LINK) ?? document.querySelector<HTMLElement>("[data-stage-head]")}
        />
      )}

      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}
