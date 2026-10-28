"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { formatDay } from "@/demo/dates";
import type { QueueRow } from "@/demo/selectors";
import { STAGE_LABELS } from "@/demo/types";
import { ChevronLeftIcon, ChevronRightIcon, StageGlyph, WarningIcon } from "../icons";
import { Tick, YearMargin } from "../marks";
import { ClaimChip } from "./claim-chip";
import { isLongOverdue, OverdueMark } from "./overdue";
import { reducedMotionNow } from "./queue-motion";

// One queue row, on a single 44 px line: board-year margin, how late (glass and words), the company,
// its stage with glyph and label, the last note in italic, the claim chip, and a chevron that opens
// the side panel. Nothing wraps on a desktop screen. Refusals are written in the row's own margin.

type RowProps = {
  row: QueueRow;
  active: boolean;
  open: boolean;
  leaving: boolean;
  shaking: boolean;
  flashing: boolean;
  error: string | undefined;
  panelId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onClaim: (id: string, name: string) => void;
  onLeft: (id: string) => void;
  onDismissError: (id: string) => void;
};

export function Timing({ row }: { row: QueueRow }) {
  if (row.daysOverdue === null || !row.company.nextFollowUpAt) return <span className="lg-qtime lg-muted">{row.timing}</span>;
  return (
    <span className="lg-qtime">
      <OverdueMark days={row.daysOverdue} dueOn={formatDay(row.company.nextFollowUpAt)} />
    </span>
  );
}

export function QueueRowView(p: RowProps) {
  const { row } = p;
  const company = row.company;
  const li = useRef<HTMLLIElement>(null);
  const onLeft = useRef(p.onLeft);
  useEffect(() => {
    onLeft.current = p.onLeft;
  });

  // After a log the check draws and the name is struck for 450 ms, then the row steps aside (140 ms)
  // and the rows below slide up into the gap (the list's FLIP).
  const { leaving } = p;
  useEffect(() => {
    if (!leaving) return;
    const el = li.current;
    if (!el) return;
    const reduce = reducedMotionNow();
    const timer = window.setTimeout(
      () => {
        if (reduce || typeof el.animate !== "function") {
          onLeft.current(company.id);
          return;
        }
        const anim = el.animate(
          [
            { opacity: 1, transform: "translateX(0)" },
            { opacity: 0, transform: "translateX(18px)" },
          ],
          { duration: 140, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" },
        );
        anim.onfinish = () => onLeft.current(company.id);
      },
      reduce ? 700 : 450,
    );
    return () => window.clearTimeout(timer);
  }, [leaving, company.id]);

  const onRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
    p.onSelect(company.id);
  };

  return (
    // The row is a mouse convenience; every action in it has its own real button for the keyboard.
    <li
      ref={li}
      data-row={company.id}
      data-active={p.active || undefined}
      data-open={p.open || undefined}
      data-leaving={leaving || undefined}
      data-od={isLongOverdue(row.daysOverdue) ? "long" : undefined}
      className={`lg-qrow lg-rule-row ${p.flashing ? "lg-settle" : ""}`}
      onClick={onRowClick}
    >
      <div className="lg-qgrid">
        <span className="lg-qm">
          <YearMargin iso={company.lastContactedAt ?? company.createdAt} />
        </span>
        <Timing row={row} />
        <span className="lg-qn">
          <span className="lg-qname">
            <button type="button" className="lg-qopen" aria-expanded={p.open} aria-controls={p.panelId} disabled={leaving} onClick={() => p.onSelect(company.id)}>
              {company.name}
            </button>
            {leaving && <span className="lg-strike" aria-hidden="true" />}
          </span>
        </span>
        <span className="lg-qstage" title={STAGE_LABELS[company.stage]}>
          <StageGlyph stage={company.stage} size={15} />
          <span className="lg-qstage-label">{STAGE_LABELS[company.stage]}</span>
        </span>
        <span className="lg-qnote lg-quote" title={row.lastNote ?? undefined}>
          {row.lastNote ? <>&ldquo;{row.lastNote}&rdquo;</> : <span className="lg-muted">No note yet</span>}
        </span>
        <span className="lg-qclaim">
          {leaving ? (
            <span className="lg-ok" role="status">
              <Tick size={20} />
              Logged
            </span>
          ) : (
            <ClaimChip claim={row.claim} companyName={company.name} onClaim={() => p.onClaim(company.id, company.name)} shaking={p.shaking} />
          )}
        </span>
        <button
          type="button"
          className="lg-qchev"
          aria-expanded={p.open}
          aria-controls={p.panelId}
          aria-label={`${p.open ? "Close" : "Open"} the side panel for ${company.name}`}
          onClick={() => p.onToggle(company.id)}
          disabled={leaving}
        >
          {p.open ? <ChevronLeftIcon size={18} /> : <ChevronRightIcon size={18} />}
        </button>
      </div>

      {p.error && (
        <div className="lg-rownote" role="alert">
          <WarningIcon size={16} />
          <span>{p.error}</span>
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={() => p.onDismissError(company.id)}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
