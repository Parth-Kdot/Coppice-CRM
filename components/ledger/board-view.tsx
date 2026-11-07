"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { moveStage, releaseClaim } from "@/app/(app)/[workspaceId]/companies/actions";
import { BoardSearch } from "@/components/board-search";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { ReplyChoice } from "@/lib/companies";
import type { BoardFilters } from "@/lib/validation";
import { useBoardDrag } from "./board-drag";
import { Slip, type BoardCardData } from "./board-slip";
import { focusSoon } from "./focus";
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
// past the 50 shown, marked "Just moved", until the next full load.
//
// Above the board: the title and count, search, the industry filter (only with 10 or more
// companies), the More menu (look-alikes, archived, template stats, keyboard shortcuts) and Add
// company. On a phone a sticky strip of stages jumps between columns. An empty workspace shows only
// the way in: Import and Add a company.

export type BoardColumnData = { stage: Stage; count: number; shown: number; moreHref: string; cards: BoardCardData[] };

const GROUPS: readonly (readonly Stage[])[] = [["NOT_CONTACTED"], ["CONTACTED"], ["REPLIED"], ["IN_CONVERSATION"], ["COMMITTED", "DECLINED"]];

// A column head prints the stage's own name (the same one the company page, the Move to menu and
// search use); in a narrow column it wraps onto two lines instead of being shortened.
const groupLabel = (group: readonly Stage[]) => (group.length > 1 ? "Closed" : STAGE_LABELS[group[0]]);

const FILTER_FROM = 10;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Menu = { id: string; anchor: HTMLButtonElement };
type Landing = { id: string; from: Stage; to: Stage; rect: DOMRect; focus: boolean };

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

// Roving tabindex: one tab stop per column. The slip links carry no tabIndex prop, so React never
// touches the attribute; this sets it after each render and when focus moves.
const SLIP_LINK = "[data-slip-link]";
function rove(link: HTMLElement) {
  const list = link.closest("ul");
  list?.querySelectorAll<HTMLElement>(SLIP_LINK).forEach((el) => el.setAttribute("tabindex", el === link ? "0" : "-1"));
}
function settleRoving(root: HTMLElement | null) {
  root?.querySelectorAll("ul.lg-slips").forEach((list) => {
    const links = [...list.querySelectorAll<HTMLElement>(SLIP_LINK)];
    if (links.length === 0) return;
    const stop = links.find((el) => el.getAttribute("tabindex") === "0") ?? links[0];
    for (const el of links) el.setAttribute("tabindex", el === stop ? "0" : "-1");
  });
}

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

  // The columns as drawn: the server's cards, plus any pinned slip the server's page left out.
  const shown = useMemo(() => {
    const onServer = new Set(columns.flatMap((c) => c.cards.map((card) => card.id)));
    return columns.map((col) => {
      const extra = [...pins.values()].filter((card) => card.stage === col.stage && !onServer.has(card.id));
      return extra.length > 0 ? { ...col, cards: [...extra, ...col.cards] } : col;
    });
  }, [columns, pins]);
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

  // Moving a slip calls the real stage action with the same form fields as the stage form. Committed
  // and Declined ask first, because they close the pitch and release any claim. The slip is pinned
  // in its new column first, drawn there once the server's page no longer has it in the old one, so
  // it can't vanish when it sorts past the 50 shown. Then it glides from where it was.
  const requestMove = async (id: string, to: Stage, from: DOMRect, focus: boolean) => {
    const card = cardOf(id);
    if (!card || card.stage === to) return;
    clearSlipError(id);
    if (TERMINAL_STAGES.includes(to)) {
      const ok = await confirm({
        message: `Move ${card.name} to ${STAGE_LABELS[to]}? This closes the pitch and releases any claim.`,
        confirmLabel: `Move to ${STAGE_LABELS[to]}`,
      });
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
    setPins((current) =>
      new Map(current).set(id, {
        ...card,
        stage: to,
        closed: closes,
        justMoved: true,
        claim: closes ? { state: "free", holderName: null, until: null } : card.claim,
      }),
    );
    landing.current = { id, from: card.stage, to, rect: from, focus };
    startTransition(async () => {
      const result = await moveStage(null, form);
      if (result.ok) {
        flash(id);
        notify(`Moved ${card.name} to ${STAGE_LABELS[to]}.`);
        if (result.data?.replyChoices) setReplyAsk({ id, name: card.name, choices: result.data.replyChoices });
      } else {
        if (landing.current?.id === id) landing.current = null;
        setPins((current) => {
          const next = new Map(current);
          if (previousPin) next.set(id, previousPin);
          else next.delete(id);
          return next;
        });
        setSlipErrors((current) => ({ ...current, [id]: result.error }));
      }
    });
  };
  const moveRef = useRef(requestMove);
  useEffect(() => {
    moveRef.current = requestMove;
  });

  const drag = useBoardDrag({ scroller, onDrop: (id, to, from) => void moveRef.current(id, to, from, false) });

  // After the data reloads, the moved slip slides from its old box to its new one and, when the move
  // came from the keyboard, takes focus. If it can't be found (a search hides it now), focus goes
  // to its new column's head, never to <body>.
  useLayoutEffect(() => {
    settleRoving(scroller.current);
    const land = landing.current;
    if (!land) return;
    const el = document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(land.id)}"]`);
    if (el && el.dataset.stage !== land.to) return; // still in the old column: the server hasn't answered
    if (!el) {
      // Waiting while the server's page still lists it in its old column.
      const stale = latest.current.shown.some((c) => c.stage === land.from && c.cards.some((card) => card.id === land.id));
      if (stale) return;
      landing.current = null;
      if (land.focus) focusSoon(`[data-stage-head="${land.to}"]`);
      return;
    }
    landing.current = null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const link = el.querySelector<HTMLElement>(SLIP_LINK);
    if (land.focus && link) {
      rove(link);
      link.focus({ preventScroll: true });
    }
    if (reducedMotion() || typeof el.animate !== "function") return;
    const to = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${land.rect.left - to.left}px, ${land.rect.top - to.top}px)` }, { transform: "translate(0, 0)" }], {
      duration: 180,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
  }, [shown, only]);

  const openMenu = useCallback((id: string, anchor: HTMLButtonElement) => setMenu((current) => (current?.id === id ? null : { id, anchor })), []);
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

  const slipOf = (id: string) => document.querySelector<HTMLElement>(`[data-slip="${CSS.escape(id)}"]`);
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
        {!empty && <BoardSearch filters={filters} industries={industries} showFilter={workspaceTotal >= FILTER_FROM || filters.industry !== ""} />}
        <div className="lg-btools-end">
          {(!empty || archivedCount > 0) && (
            <span className="lg-bmore" data-badge={duplicateCount > 0 || undefined}>
              <OverflowMenu label={moreLabel} items={moreItems} data-tour="board-more" />
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

// The phone's stage strip: one button per column (glyph, short name, count), sticky above the
// columns. Pressing one scrolls the board to that column; the column in view is marked. Hidden on
// wider screens, where every column shows at once.
function BoardStrip({ scroller, counts }: { scroller: RefObject<HTMLDivElement | null>; counts: number[] }) {
  const [inView, setInView] = useState(0);

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const cols = [...root.querySelectorAll<HTMLElement>(":scope > .lg-bcol")];
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
        let best = 0;
        cols.forEach((col, i) => {
          if ((ratios.get(col) ?? 0) > (ratios.get(cols[best]) ?? 0)) best = i;
        });
        setInView(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    cols.forEach((col) => observer.observe(col));
    return () => observer.disconnect();
  }, [scroller]);

  const jump = (index: number) => {
    const root = scroller.current;
    const col = root?.querySelectorAll<HTMLElement>(":scope > .lg-bcol")[index];
    if (!root || !col) return;
    root.scrollTo({ left: col.offsetLeft, behavior: reducedMotion() ? "auto" : "smooth" });
    setInView(index);
  };

  return (
    <div className="lg-bstrip" role="group" aria-label="Jump to a stage" data-tour="board-strip">
      {GROUPS.map((group, i) => (
        <button key={group.join("-")} type="button" className="lg-bstrip-btn" aria-current={inView === i ? "true" : undefined} onClick={() => jump(i)}>
          <StageGlyph stage={group[0]} size={15} />
          <span>{groupLabel(group)}</span>
          <span className="lg-bstrip-n">{counts[i].toLocaleString("en-US")}</span>
        </button>
      ))}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Tab", "Next column"],
  ["Up, Down", "Previous or next company in a column"],
  ["Left, Right", "The column beside it"],
  ["Enter", "Open the company"],
  ["m", "Move it to another stage, or claim it"],
  ["c", "Claim it"],
  ["Drag", "Drop a slip on another stage to move it"],
];

// "Keyboard shortcuts" from the More menu: a small dialog, so the keys are never a permanent line on
// the board. Escape or Close shuts it and focus goes back to the More button.
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => {
      el?.close();
      focusSoon('[data-tour="board-more"]');
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="lg-dialog lg-bkeys"
      aria-labelledby="board-keys-h"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="lg-bkeys-body">
        <h2 id="board-keys-h" className="lg-h3">
          Keyboard shortcuts
        </h2>
        <p className="lg-hint">On a focused company slip:</p>
        <dl className="lg-bkeys-list">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <div className="lg-bkeys-acts">
          <button type="button" className="lg-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
