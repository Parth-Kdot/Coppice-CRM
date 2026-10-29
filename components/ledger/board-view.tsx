"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormActions } from "@/app/demo/_ledger/form-actions";
import { BoardSearch } from "./board-search";
import type { Stage } from "@/generated/prisma/enums";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import type { BoardFilters } from "@/lib/validation";
import { useBoardDrag } from "./board-drag";
import { Slip, type BoardCardData } from "./board-slip";
import { CloseIcon, DuplicateIcon, PlusIcon, StageGlyph } from "./icons";
import { MoveMenu } from "./move-menu";
import { useConfirm, useNotify } from "./providers";
import { Count, Empty } from "./shared";
import "./board.css";

// The board. It fits the viewport: five ruled columns side by side (the last one holds Committed over
// Declined) and each column scrolls on its own. The row of stage names across the top is a station
// strip: every station shows its glyph, its name and its count, and pressing one shows only that
// stage (press it again to clear). Slips move three ways: drag one onto another stage, press its
// stage glyph button for a one-click Move to menu, or press m while it has focus. All three call the
// real stage action; a refusal (someone else holds the company) is written in the slip's margin.

export type BoardColumnData = { stage: Stage; count: number; cards: BoardCardData[]; hasMore: boolean; showAllHref: string };

const GROUPS: readonly (readonly Stage[])[] = [["NOT_CONTACTED"], ["CONTACTED"], ["REPLIED"], ["IN_CONVERSATION"], ["COMMITTED", "DECLINED"]];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Menu = { id: string; anchor: HTMLButtonElement };
type Landing = { id: string; stage: Stage; rect: DOMRect; focus: boolean };

type Props = {
  workspaceId: string;
  columns: BoardColumnData[];
  filters: BoardFilters;
  industries: string[];
  total: number;
  filtered: boolean;
  duplicateLabel: string;
  archivedCount: number;
  dupesHref: string;
  archivedHref: string;
  dupesOpen: boolean;
  archivedOpen: boolean;
};

export function BoardView({ workspaceId, columns, filters, industries, total, filtered, duplicateLabel, archivedCount, dupesHref, archivedHref, dupesOpen, archivedOpen }: Props) {
  const { moveStage } = useFormActions();
  const notify = useNotify();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [only, setOnly] = useState<Stage | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const landing = useRef<Landing | null>(null);
  const flashTimers = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  const byStage = useMemo(() => new Map(columns.map((c) => [c.stage, c] as const)), [columns]);
  const cardOf = (id: string) => columns.flatMap((c) => c.cards).find((card) => card.id === id);

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

  const clearMoveError = (id: string) =>
    setMoveErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });

  // Moving a slip calls the real stage action with the same form fields as the stage form. Committed
  // and Declined ask first, because they close the pitch and release any claim. Once it moves, the
  // page reloads its data and the slip glides from where it was to its new column.
  const requestMove = async (id: string, to: Stage, from: DOMRect, focus: boolean) => {
    const card = cardOf(id);
    if (!card || card.stage === to) return;
    clearMoveError(id);
    if (TERMINAL_STAGES.includes(to)) {
      const ok = await confirm({
        message: `Move ${card.name} to ${STAGE_LABELS[to]}? This closes the pitch and releases any claim.`,
        confirmLabel: `Move to ${STAGE_LABELS[to]}`,
      });
      if (!ok) return;
    }
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("companyId", id);
    form.set("stage", to);
    landing.current = { id, stage: card.stage, rect: from, focus };
    startTransition(async () => {
      const result = await moveStage(null, form);
      if (result.ok) {
        flash(id);
        notify(`Moved ${card.name} to ${STAGE_LABELS[to]}.`);
      } else {
        if (landing.current?.id === id) landing.current = null;
        setMoveErrors((current) => ({ ...current, [id]: result.error }));
      }
    });
  };

  const drag = useBoardDrag({ scroller, onDrop: (id, to, from) => void requestMove(id, to, from, false) });

  // After the data reloads, the moved slip slides from its old box to its new one.
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
  }, [columns]);

  const openMenu = (id: string, anchor: HTMLButtonElement) => setMenu((current) => (current?.id === id ? null : { id, anchor }));
  const menuCard = menu ? cardOf(menu.id) : undefined;

  const renderStage = (col: BoardColumnData) => {
    const rail = only !== null && only !== col.stage;
    const label = STAGE_LABELS[col.stage];
    return (
      <div key={col.stage} className="lg-bstage" data-drop-stage={col.stage} data-state={rail ? "rail" : only ? "focus" : undefined} data-over={drag.over === col.stage || undefined}>
        <h2 className="lg-st-h">
          <button
            type="button"
            className="lg-st"
            aria-pressed={only === col.stage}
            title={only === col.stage ? "Show every stage again" : `Show only ${label}`}
            onClick={() => setOnly(only === col.stage ? null : col.stage)}
          >
            <span className="lg-st-dot">
              <StageGlyph stage={col.stage} size={16} />
            </span>
            <span className="lg-st-name lg-sc">{label}</span>
            <span className="lg-st-n">
              <Count value={col.count} />
              <span className="lg-sr"> {col.count === 1 ? "company" : "companies"}</span>
            </span>
          </button>
        </h2>
        {!rail && (
          <div className="lg-bbody">
            <ul className="lg-slips" aria-label={`${label}, ${col.count}`}>
              {drag.over === col.stage && (
                <li className="lg-dropline" aria-hidden="true">
                  <span className="lg-tag">Move to {label}</span>
                </li>
              )}
              {col.cards.map((card) => (
                <Slip
                  key={card.id}
                  workspaceId={workspaceId}
                  card={card}
                  flashing={flashing.has(card.id)}
                  lifted={drag.dragging === card.id}
                  menuOpen={menu?.id === card.id}
                  moveError={moveErrors[card.id]}
                  onDismissMove={() => clearMoveError(card.id)}
                  onOpenMenu={(button) => openMenu(card.id, button)}
                  onPointerDown={drag.onPointerDown}
                />
              ))}
            </ul>
            {col.cards.length === 0 && !drag.dragging && <p className="lg-colempty">Nothing in this stage.</p>}
            {col.hasMore && (
              <p className="lg-colmore">
                <Link href={col.showAllHref} className="lg-link" scroll={false}>
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
        <h1 className="lg-h1 lg-btop-title" tabIndex={-1}>
          Board{" "}
          <span className="lg-h1-count">
            <Count value={total} />
          </span>
        </h1>
        <BoardSearch filters={filters} industries={industries} />
        {only && (
          <button type="button" className="lg-fchip" onClick={() => setOnly(null)}>
            <span>Only {STAGE_LABELS[only]}</span>
            <CloseIcon size={14} />
            <span className="lg-sr">Show every stage again</span>
          </button>
        )}
        <div className="lg-btools-end">
          <Link href={dupesHref} scroll={false} className="lg-toggle" aria-expanded={dupesOpen} aria-haspopup="dialog">
            <DuplicateIcon size={16} />
            <span>
              Possible duplicates <span className="lg-num">{duplicateLabel}</span>
            </span>
          </Link>
          <Link href={archivedHref} scroll={false} className="lg-toggle" aria-expanded={archivedOpen} aria-haspopup="dialog">
            <span>
              Archived <span className="lg-num">{archivedCount}</span>
            </span>
          </Link>
        </div>
        <Link href={`/demo/w/${workspaceId}/companies/new`} className="lg-btn lg-btn-primary lg-btop-add">
          <PlusIcon size={16} />
          Add company
        </Link>
      </div>

      {total === 0 ? (
        <Empty kind="board">
          <p className="lg-empty-title">{filtered ? "No companies match." : "No companies yet."}</p>
          {!filtered && (
            <p>
              <Link href={`/demo/w/${workspaceId}/companies/new`} className="lg-link">
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
            data-focus={only ?? undefined}
            data-dragging={drag.dragging ? "" : undefined}
          >
            {GROUPS.map((group) => {
              const cols = group.map((stage) => byStage.get(stage) as BoardColumnData);
              const allRail = only !== null && !group.includes(only);
              return (
                <section key={group.join("-")} className="lg-bcol" data-split={group.length > 1 || undefined} data-rail={allRail || undefined} aria-label={group.map((s) => STAGE_LABELS[s]).join(" and ")}>
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
          onClose={(restore) => {
            setMenu(null);
            if (restore) menu.anchor.focus();
          }}
          onPick={(stage) => {
            const from = (menu.anchor.closest("[data-slip]") as HTMLElement | null)?.getBoundingClientRect() ?? menu.anchor.getBoundingClientRect();
            setMenu(null);
            void requestMove(menu.id, stage, from, true);
          }}
        />
      )}
    </div>
  );
}
