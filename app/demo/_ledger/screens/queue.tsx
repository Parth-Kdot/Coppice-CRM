"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDay } from "@/demo/dates";
import type { QueueRow } from "@/demo/selectors";
import { demoRoutes } from "@/demo/routes";
import { useMe, useQueue, useQueueFilters } from "@/demo/store";
import { CHANNEL_LABELS, type Channel } from "@/demo/types";
import { CalendarIcon, ChevronDownIcon, ChevronRightIcon, ExternalIcon, LogIcon, OverdueIcon, PlusIcon, WarningIcon } from "../icons";
import { Ribbon, Tick, YearMargin } from "../marks";
import { LogOutreachForm } from "./log-form";
import { ClaimBadge, Count, Empty, PageHead, useClaimAction, useFlash, useLatestOutreach } from "./shared";

// The queue: who should I follow up with today? Rows are ruled, most overdue first, with the
// board-year margin on the left. Claim in place (a gilt ribbon drops onto the row), log outreach in
// place (the check draws, the name is struck, the row slides out and the rows below close the gap),
// open the last note with the chevron, and work it from the keyboard.

type Leaving = { row: QueueRow; index: number };

function Timing({ row }: { row: QueueRow }) {
  if (row.daysOverdue === null) {
    return <span className="lg-qtime lg-muted">{row.timing}</span>;
  }
  if (row.daysOverdue > 0) {
    return (
      <span className="lg-qtime lg-late">
        <OverdueIcon size={16} />
        {row.timing}
      </span>
    );
  }
  return (
    <span className="lg-qtime">
      <CalendarIcon size={16} />
      {row.timing}
    </span>
  );
}

type RowProps = {
  ws: string;
  row: QueueRow;
  index: number;
  active: boolean;
  leaving: boolean;
  open: boolean;
  logging: boolean;
  dropping: boolean;
  shaking: boolean;
  flashing: boolean;
  error: string | undefined;
  latest: { sentAt: string; by: string; channel: string; note: string | null } | undefined;
  onClaim: () => void;
  onToggle: () => void;
  onOpenLog: () => void;
  onCloseLog: () => void;
  onLogged: () => void;
  onLeft: () => void;
  onDismissError: () => void;
};

function QueueRowView(p: RowProps) {
  const { row } = p;
  const company = row.company;
  const li = useRef<HTMLLIElement>(null);
  const detailId = `qd-${company.id}`;

  // After a log, the row waits 400 ms (the check draws, the name is struck) and then slides down and out
  // while the rows below close the gap, 240 ms.
  const { leaving, onLeft } = p;
  useEffect(() => {
    if (!leaving) return;
    const el = li.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => {
        if (reduce || typeof el.animate !== "function") {
          onLeft();
          return;
        }
        const height = el.getBoundingClientRect().height;
        const anim = el.animate(
          [
            { height: `${height}px`, minHeight: `${height}px`, opacity: 1, transform: "translateY(0)" },
            { height: "0px", minHeight: "0px", opacity: 0, transform: "translateY(14px)" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "forwards" },
        );
        anim.onfinish = () => onLeft();
      },
      reduce ? 700 : 400,
    );
    return () => window.clearTimeout(timer);
  }, [leaving, onLeft]);

  const mine = row.claim.state === "mine";
  return (
    <li
      ref={li}
      data-row={company.id}
      data-active={p.active || undefined}
      data-leaving={leaving || undefined}
      className={`lg-qrow ${p.flashing ? "lg-settle" : ""}`}
    >
      <div className="lg-qgrid">
        {mine && <Ribbon size="sm" drop={p.dropping} className="lg-qribbon" />}
        <span className="lg-qm">
          <YearMargin iso={company.lastContactedAt ?? company.createdAt} />
        </span>
        <span className="lg-qn">
          <Link href={demoRoutes.company(p.ws, company.id)} className="lg-qlink">
            {company.name}
          </Link>
          {leaving && <span className="lg-strike" aria-hidden="true" />}
        </span>
        <span className="lg-qnote lg-quote" title={row.lastNote ?? undefined}>
          {row.lastNote ? <>&ldquo;{row.lastNote}&rdquo;</> : <span className="lg-muted">No note yet</span>}
        </span>
        <Timing row={row} />
        <span className="lg-qclaim">
          <ClaimBadge claim={row.claim} />
        </span>
        <span className="lg-qact">
          {leaving ? (
            <span className="lg-ok" role="status">
              <Tick size={20} />
              Logged
            </span>
          ) : row.action === "claim" ? (
            <button type="button" className={`lg-btn lg-btn-primary lg-btn-sm ${p.shaking ? "lg-btn-shake" : ""}`} onClick={p.onClaim}>
              Claim
            </button>
          ) : row.action === "log-outreach" ? (
            <button type="button" className="lg-btn lg-btn-sm" onClick={p.onOpenLog} aria-expanded={p.logging} aria-controls={detailId}>
              <LogIcon size={16} />
              Log outreach
            </button>
          ) : null}
        </span>
        <button
          type="button"
          className="lg-qchev"
          aria-expanded={p.open}
          aria-controls={detailId}
          aria-label={`${p.open ? "Hide" : "Show"} the last outreach for ${company.name}`}
          onClick={p.onToggle}
          disabled={leaving}
        >
          {p.open ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
        </button>
      </div>

      <div className="lg-disclose" data-open={p.open} id={detailId}>
        <div className="lg-disclose-inner" inert={!p.open}>
          <div className="lg-qdetail lg-disclose-fade">
            {p.latest ? (
              <>
                <p className="lg-sc lg-muted">
                  Last outreach, {formatDay(p.latest.sentAt)}, {CHANNEL_LABELS[p.latest.channel as Channel]}, by {p.latest.by}
                </p>
                {p.latest.note && <p className="lg-quote lg-qfull">&ldquo;{p.latest.note}&rdquo;</p>}
              </>
            ) : (
              <p className="lg-muted">No outreach has been logged on this company yet.</p>
            )}
            <div className="lg-qdetail-actions">
              <Link href={demoRoutes.company(p.ws, company.id, { anchor: "logOutreach" })} className="lg-link">
                Open the company page
                <ExternalIcon size={14} className="inline-block align-[-2px] ml-1" />
              </Link>
              {mine && !p.logging && (
                <button type="button" className="lg-btn lg-btn-sm" onClick={p.onOpenLog}>
                  <LogIcon size={16} />
                  Log outreach here
                </button>
              )}
            </div>
            {p.logging && <LogOutreachForm ws={p.ws} companyId={company.id} compact autoFocus onLogged={p.onLogged} onCancel={p.onCloseLog} />}
          </div>
        </div>
      </div>

      {p.error && (
        <div className="lg-rownote" role="alert">
          <WarningIcon size={16} />
          <span>{p.error}</span>
          <button type="button" className="lg-btn lg-btn-quiet lg-btn-sm" onClick={p.onDismissError}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}

export function QueueScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const filters = useQueueFilters();
  const queue = useQueue(ws, filters);
  const me = useMe(ws);
  const latest = useLatestOutreach(ws);
  const { flashing, flash } = useFlash();
  const claimAction = useClaimAction(ws, flash);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The due list as shown: live rows, with a row that has just been logged held in place until its exit finishes.
  const dueRows = useMemo(() => {
    const leavingIds = new Set(leaving.map((l) => l.row.company.id));
    const rows = queue.due.filter((r) => !leavingIds.has(r.company.id));
    [...leaving]
      .sort((a, b) => a.index - b.index)
      .forEach((l) => rows.splice(Math.min(l.index, rows.length), 0, l.row));
    return rows;
  }, [queue.due, leaving]);
  const neverRows = useMemo(() => queue.never ?? [], [queue.never]);
  const leavingIds = useMemo(() => new Set(leaving.map((l) => l.row.company.id)), [leaving]);

  const navRows = useMemo(() => [...dueRows, ...neverRows].filter((r) => !leavingIds.has(r.company.id)), [dueRows, neverRows, leavingIds]);
  const navRef = useRef(navRows);
  const activeRef = useRef(activeId);
  useEffect(() => {
    navRef.current = navRows;
    activeRef.current = activeId;
  });

  const toggleOpen = useCallback((id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openLog = useCallback((id: string) => {
    setOpenIds((current) => new Set(current).add(id));
    setLoggingId(id);
  }, []);

  // Keyboard: j and k move the row highlight, c claims, l logs outreach, Enter opens the company.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      const rows = navRef.current;
      if (rows.length === 0) return;
      const current = rows.findIndex((r) => r.company.id === activeRef.current);
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = key === "j" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
        const id = rows[next].company.id;
        setActiveId(id);
        requestAnimationFrame(() => document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
        return;
      }
      const row = current >= 0 ? rows[current] : undefined;
      if (!row) return;
      if (key === "c" && row.action === "claim") {
        event.preventDefault();
        claimAction.claim(row.company.id, row.company.name);
      } else if (key === "l" && row.action === "log-outreach") {
        event.preventDefault();
        openLog(row.company.id);
      } else if (key === "enter" && (document.activeElement === document.body || document.activeElement === null)) {
        event.preventDefault();
        router.push(demoRoutes.company(ws, row.company.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [claimAction, openLog, router, ws]);

  const renderRow = (row: QueueRow, index: number) => {
    const id = row.company.id;
    const isLeaving = leavingIds.has(id);
    return (
      <QueueRowView
        key={id}
        ws={ws}
        row={row}
        index={index}
        active={activeId === id}
        leaving={isLeaving}
        open={openIds.has(id) && !isLeaving}
        logging={loggingId === id && !isLeaving}
        dropping={claimAction.dropping === id}
        shaking={claimAction.shaking === id}
        flashing={flashing.has(id)}
        error={claimAction.errors[id]}
        latest={latest.get(id)}
        onClaim={() => claimAction.claim(id, row.company.name)}
        onToggle={() => toggleOpen(id)}
        onOpenLog={() => openLog(id)}
        onCloseLog={() => setLoggingId(null)}
        onLogged={() => {
          setLeaving((cur) => [...cur, { row, index }]);
          setLoggingId(null);
          flash(id);
        }}
        onLeft={() => setLeaving((cur) => cur.filter((l) => l.row.company.id !== id))}
        onDismissError={() => claimAction.dismiss(id)}
      />
    );
  };

  const neverHref = demoRoutes.queue(ws, { mine: filters.mine, never: !filters.never });

  return (
    <div className="lg-queue">
      <PageHead title="Follow-ups due" count={queue.dueCount} sub={<>You are {me.roleLabel}.</>}>
        <Link href={demoRoutes.queue(ws, { mine: !filters.mine, never: filters.never })} scroll={false} className="lg-toggle lg-sc" aria-pressed={filters.mine} data-on={filters.mine || undefined}>
          Only mine
        </Link>
        <Link href={demoRoutes.import(ws)} className="lg-btn">
          Import
        </Link>
        <Link href={demoRoutes.newCompany(ws)} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          Add company
        </Link>
      </PageHead>

      <div className="lg-qhead" aria-hidden="true">
        <span className="lg-qm lg-sc">Board</span>
        <span className="lg-qn lg-sc">Company</span>
        <span className="lg-qnote lg-sc">Last note</span>
        <span className="lg-qtime lg-sc">When</span>
        <span className="lg-qclaim lg-sc">Claim</span>
        <span className="lg-qact" />
        <span className="lg-qchev" />
      </div>

      {dueRows.length === 0 ? (
        <Empty kind="queue">
          <p className="lg-empty-title">{filters.mine ? "Nothing of yours is due." : "Nothing is due."}</p>
          {!filters.mine && <p>Log outreach with a follow-up date and it comes back here when it&apos;s due.</p>}
        </Empty>
      ) : (
        <ul className="lg-qlist" aria-label="Follow-ups due">
          {dueRows.map((row, i) => renderRow(row, i))}
        </ul>
      )}
      {queue.hasMoreDue && (
        <p className="mt-3">
          <Link href={demoRoutes.queue(ws, { mine: filters.mine, never: filters.never, all: "due" })} className="lg-link">
            Show all {queue.dueCount}
          </Link>
        </p>
      )}

      <section className="lg-never" aria-labelledby="never-title">
        <h2 id="never-title" className="lg-never-title">
          <Link href={neverHref} scroll={false} aria-expanded={filters.never} className="lg-never-toggle">
            {filters.never ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
            <span className="lg-h2">Never contacted</span>
            <span className="lg-never-count">
              <Count value={queue.neverCount} />
            </span>
          </Link>
        </h2>
        {filters.never && queue.never && (
          <>
            {neverRows.length === 0 ? (
              <p className="lg-muted py-4">No fresh leads{filters.mine ? " that you hold" : ""}.</p>
            ) : (
              <ul className="lg-qlist" aria-label="Never contacted">
                {neverRows.map((row, i) => renderRow(row, dueRows.length + i))}
              </ul>
            )}
            {queue.hasMoreNever && (
              <p className="mt-3">
                <Link href={demoRoutes.queue(ws, { mine: filters.mine, never: true, all: "never" })} className="lg-link">
                  Show all {queue.neverCount}
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <aside className="lg-keys" aria-label="Keyboard shortcuts">
        <span className="lg-sc">Key</span>
        <span>
          <kbd>j</kbd> <kbd>k</kbd> move the highlight
        </span>
        <span>
          <kbd>c</kbd> claims
        </span>
        <span>
          <kbd>l</kbd> logs outreach
        </span>
        <span>
          <kbd>Enter</kbd> opens the company
        </span>
      </aside>
    </div>
  );
}
