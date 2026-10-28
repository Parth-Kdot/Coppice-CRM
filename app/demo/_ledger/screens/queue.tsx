"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { demoRoutes, type QueueFilters, type QueueSort, type QueueView } from "@/demo/routes";
import type { QueueRow } from "@/demo/selectors";
import { useMe, useQueueBook, useQueueFilters } from "@/demo/store";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../icons";
import { useNotify } from "../providers";
import { FocusMode } from "./queue-focus";
import { buildQueue } from "./queue-model";
import { useFlip, useGlide, useMediaQuery } from "./queue-motion";
import { PANEL_ID, QueuePanel } from "./queue-panel";
import { QueueRowView } from "./queue-rows";
import { TABPANEL_ID, Toolbar, Totals, type TotalKey } from "./queue-toolbar";
import { Count, Empty, PageHead, useClaimAction, useFlash, useLatestOutreach } from "./shared";

// The queue, the workspace home: who should I follow up with today?
//
//   a totals line that filters (Overdue, Due this week, Held by you, Never contacted)
//   a toolbar: view tabs, a ledger-style sort menu, and the One at a time switch
//   ruled rows on one 44 px line, with a moss bar that glides to the selected row
//   a side panel (the facing page) for the selected company, with its last three entries and a fast log form
//   keys: j and k move, Enter opens the panel, c claims, l logs, Escape closes it, / and Ctrl K search
//   focus mode: one company at a time, as a card
//
// The view, the sort and the Overdue filter live in the URL, so a view can be bookmarked and Back works.

const PAGE_CAP = 50;
const FOCUS_KEY = "coppice:queue:one-at-a-time";

// The One at a time switch, remembered in localStorage. Every read and write is guarded: the store
// can be missing or blocked (private windows, blocked site data), and the switch then simply works for
// this visit and is forgotten after it.
const flagListeners = new Set<() => void>();
let flagCache: boolean | null = null;
function readFlag(): boolean {
  if (flagCache === null) {
    try {
      flagCache = window.localStorage.getItem(FOCUS_KEY) === "1";
    } catch {
      flagCache = false;
    }
  }
  return flagCache;
}
function subscribeFlag(notify: () => void) {
  const onStorage = () => {
    flagCache = null;
    notify();
  };
  flagListeners.add(notify);
  window.addEventListener("storage", onStorage);
  return () => {
    flagListeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}
function writeFlag(next: boolean) {
  flagCache = next;
  try {
    window.localStorage.setItem(FOCUS_KEY, next ? "1" : "0");
  } catch {
    // Nothing remembers the choice.
  }
  flagListeners.forEach((listener) => listener());
}
const useOneAtATime = (): [boolean, (on: boolean) => void] => [useSyncExternalStore(subscribeFlag, readFlag, () => false), writeFlag];

type Leaving = { row: QueueRow; index: number };

const rowFocusTarget = (id: string) => document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] .lg-qopen`);

export function QueueScreen({ ws }: { ws: string }) {
  const router = useRouter();
  const notify = useNotify();
  const filters = useQueueFilters();
  const book = useQueueBook(ws);
  const me = useMe(ws);
  const latest = useLatestOutreach(ws);
  const { flashing, flash } = useFlash();
  const claimAction = useClaimAction(ws, flash);
  const [focus, setFocus] = useOneAtATime();
  const inline = useMediaQuery("(min-width: 1280px)");

  const model = useMemo(() => buildQueue(book, filters), [book, filters]);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const glide = useRef<HTMLSpanElement>(null);

  // ----- Rows as shown: capped, with a row that has just been logged held in place until it has left -----
  const mainCap = filters.all === (model.view === "never" ? "never" : "due") ? 2000 : PAGE_CAP;
  const freshCap = filters.all === "never" ? 2000 : PAGE_CAP;
  const modelIds = useMemo(() => new Set(model.rows.map((r) => r.company.id)), [model.rows]);
  const leavingIds = useMemo(() => new Set(leaving.filter((l) => !modelIds.has(l.row.company.id)).map((l) => l.row.company.id)), [leaving, modelIds]);
  const mainRows = useMemo(() => {
    const rows = model.rows.slice(0, mainCap);
    [...leaving]
      .filter((l) => leavingIds.has(l.row.company.id))
      .sort((a, b) => a.index - b.index)
      .forEach((l) => rows.splice(Math.min(l.index, rows.length), 0, l.row));
    return rows;
  }, [model.rows, mainCap, leaving, leavingIds]);
  const freshRows = useMemo(() => (filters.never ? model.fresh.slice(0, freshCap) : []), [filters.never, model.fresh, freshCap]);
  const navRows = useMemo(() => [...mainRows, ...freshRows].filter((r) => !leavingIds.has(r.company.id)), [mainRows, freshRows, leavingIds]);
  const signature = useMemo(() => [...mainRows, ...freshRows].map((r) => r.company.id).join(","), [mainRows, freshRows]);

  // The panel closes when its company is no longer in the workspace's open list.
  const panelOpen = panelId !== null && !focus && book.some((r) => r.company.id === panelId);
  const sheet = panelOpen && !inline;

  useFlip(body, focus ? "" : signature);
  useGlide(body, glide, focus ? null : activeId, `${signature}|${panelOpen}|${inline}`);

  // ----- Changing the URL filters -----
  const go = useCallback(
    (patch: Partial<QueueFilters>) => {
      const next: QueueFilters = { ...filters, all: null, ...patch };
      next.mine = next.view === "mine";
      router.replace(demoRoutes.queue(ws, next), { scroll: false });
    },
    [filters, router, ws],
  );
  const pickView = (view: QueueView) => go({ view, overdue: false });
  const pickSort = (sort: QueueSort) => go({ sort });
  const pickTotal = (key: TotalKey) => {
    if (key === "overdue") go(model.overdue ? { overdue: false } : { view: "all", overdue: true });
    else {
      const view: QueueView = key === "week" ? "week" : key === "mine" ? "mine" : "never";
      go(model.view === view ? { view: "all", overdue: false } : { view, overdue: false });
    }
  };

  // ----- Selecting, opening and closing -----
  const select = useCallback((id: string, options: { logging?: boolean; focusPanel?: boolean } = {}) => {
    setActiveId(id);
    setPanelId(id);
    setLogging(options.logging ?? false);
    if (options.focusPanel) requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }, []);

  const closePanel = useCallback(() => {
    const id = panelId;
    setPanelId(null);
    setLogging(false);
    if (id) requestAnimationFrame(() => rowFocusTarget(id)?.focus());
  }, [panelId]);

  const toggle = useCallback(
    (id: string) => {
      if (panelId === id) closePanel();
      else select(id, { focusPanel: true });
    },
    [closePanel, panelId, select],
  );

  // ----- Logging from the panel: the row is struck and leaves, or stays if it still belongs in the view -----
  const logged = useCallback(
    (id: string) => {
      const index = mainRows.findIndex((r) => r.company.id === id);
      const row = mainRows[index] ?? freshRows.find((r) => r.company.id === id);
      setPanelId(null);
      setLogging(false);
      flash(id);
      if (!row) return;
      setLeaving((cur) => [...cur.filter((l) => l.row.company.id !== id), { row, index: Math.max(index, 0) }]);
      // A row that still belongs in this view never leaves; its held copy is dropped a moment later.
      window.setTimeout(() => setLeaving((cur) => cur.filter((l) => l.row.company.id !== id)), 2400);
    },
    [flash, freshRows, mainRows],
  );

  const navRef = useRef(navRows);
  const activeRef = useRef(activeId);
  useEffect(() => {
    navRef.current = navRows;
    activeRef.current = activeId;
  });

  const leavingRef = useRef(leaving);
  useEffect(() => {
    leavingRef.current = leaving;
  });
  const onLeft = useCallback((id: string) => {
    // The highlight moves to the row that closes the gap, and the keyboard carries on from there.
    const rows = navRef.current;
    const index = leavingRef.current.find((l) => l.row.company.id === id)?.index ?? 0;
    const neighbour = rows[Math.min(index, rows.length - 1)];
    setLeaving((cur) => cur.filter((l) => l.row.company.id !== id));
    if (activeRef.current === id && neighbour) {
      setActiveId(neighbour.company.id);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) rowFocusTarget(neighbour.company.id)?.focus();
      });
    }
  }, []);

  // ----- Keyboard -----
  useEffect(() => {
    if (focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest('[role="listbox"], .lg-insp, .lg-cal'))) return;
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      const rows = navRef.current;
      if (rows.length === 0) return;
      const current = rows.findIndex((r) => r.company.id === activeRef.current);
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = key === "j" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
        const id = rows[next].company.id;
        setActiveId(id);
        // The panel follows the selection. Focus follows too, so Enter and Space act on what is lit.
        setPanelId((open) => (open ? id : open));
        setLogging(false);
        rowFocusTarget(id)?.focus();
        return;
      }
      const row = current >= 0 ? rows[current] : undefined;
      if (!row) return;
      if (key === "c" && row.action === "claim") {
        event.preventDefault();
        claimAction.claim(row.company.id, row.company.name);
      } else if (key === "l") {
        event.preventDefault();
        if (row.action === "log-outreach") select(row.company.id, { logging: true });
        else if (row.action === "claim") notify("Claim it first, then log your outreach.");
      } else if (key === "enter" && (document.activeElement === document.body || document.activeElement === null)) {
        event.preventDefault();
        select(row.company.id, { focusPanel: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [claimAction, focus, notify, select]);

  // Escape closes the inline panel and puts focus back on its row. (As a sheet, the dialog does it.)
  useEffect(() => {
    if (!panelOpen || sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel, panelOpen, sheet]);

  // ----- Pieces -----
  const renderRow = (row: QueueRow) => {
    const id = row.company.id;
    return (
      <QueueRowView
        key={id}
        row={row}
        active={activeId === id && !focus}
        open={panelOpen && panelId === id}
        leaving={leavingIds.has(id)}
        shaking={claimAction.shaking === id}
        flashing={flashing.has(id)}
        error={claimAction.errors[id]}
        panelId={PANEL_ID}
        onSelect={(rowId) => select(rowId, { focusPanel: true })}
        onToggle={toggle}
        onClaim={claimAction.claim}
        onLeft={onLeft}
        onDismissError={claimAction.dismiss}
      />
    );
  };

  const focusRows = useMemo(() => [...model.rows].sort((a, b) => (b.daysOverdue ?? -1e9) - (a.daysOverdue ?? -1e9) || a.company.name.localeCompare(b.company.name)), [model.rows]);

  const emptyTitle = model.overdue ? "Nothing is overdue." : model.view === "mine" ? "Nothing of yours is due." : model.view === "week" ? "Nothing is due this week." : model.view === "never" ? "No fresh leads." : "Nothing is due.";
  const emptyHint =
    model.view === "mine"
      ? "Claim a company from All due and it shows here."
      : model.view === "all" && !model.overdue
        ? "Log outreach with a follow-up date and it comes back here when it's due."
        : model.view === "never"
          ? "Every company has been contacted or is held by someone."
          : "Try another tab.";
  const viewName = model.view === "mine" ? "Mine" : model.view === "week" ? "This week" : model.view === "never" ? "Never contacted" : "All due";
  const neverHref = demoRoutes.queue(ws, { ...filters, never: !filters.never, all: null });
  const allHref = demoRoutes.queue(ws, { ...filters, all: model.view === "never" ? "never" : "due" });

  const panel = panelOpen && panelId && (
    <QueuePanel
      key={panelId}
      ref={panelRef}
      ws={ws}
      companyId={panelId}
      sheet={sheet}
      logging={logging}
      claimAction={claimAction}
      onLogging={setLogging}
      onLogged={logged}
      onClose={closePanel}
    />
  );

  return (
    <div className="lg-queue">
      <PageHead title="Follow-ups due" count={model.totals.due} sub={<>You are {me.roleLabel}.</>}>
        <Link href={demoRoutes.import(ws)} className="lg-btn">
          Import
        </Link>
        <Link href={demoRoutes.newCompany(ws)} className="lg-btn lg-btn-primary">
          <PlusIcon size={16} />
          Add company
        </Link>
      </PageHead>

      <Totals totals={model.totals} view={model.view} overdue={model.overdue} onPick={pickTotal} />
      <Toolbar view={model.view} sort={filters.sort} focus={focus} onView={pickView} onSort={pickSort} onFocus={setFocus} />

      <div className="lg-qlayout" data-panel={panelOpen && inline ? "inline" : undefined}>
        <div className="lg-qmain" role="tabpanel" id={TABPANEL_ID} aria-labelledby={`queue-tab-${model.view}`}>
          {focus ? (
            <FocusMode
              ws={ws}
              rows={focusRows}
              claimAction={claimAction}
              latest={latest}
              emptyTitle="All caught up"
              emptyHint={model.view === "all" && !model.overdue ? "Nothing is due. Log outreach with a follow-up date and it comes back here when it's due." : `Nothing left in ${viewName}${model.overdue ? ", overdue" : ""}.`}
              resetKey={`${model.view}|${model.overdue}`}
            />
          ) : (
            <div className="lg-qtable">
              <div className="lg-qhead" aria-hidden="true">
                <span className="lg-qm lg-sc">Board</span>
                <span className="lg-qtime lg-sc">When</span>
                <span className="lg-qn lg-sc">Company</span>
                <span className="lg-qstage lg-sc">Stage</span>
                <span className="lg-qnote lg-sc">Last note</span>
                <span className="lg-qclaim lg-sc">Claim</span>
                <span className="lg-qchev" />
              </div>

              <div className="lg-qbody" ref={body}>
                <span className="lg-qglide" ref={glide} aria-hidden="true" data-hidden="true" />
                {mainRows.length === 0 ? (
                  <Empty kind={`queue-${model.view}`}>
                    <p className="lg-empty-title">{emptyTitle}</p>
                    <p>{emptyHint}</p>
                  </Empty>
                ) : (
                  <ul className="lg-qlist" aria-label={viewName}>
                    {mainRows.map(renderRow)}
                  </ul>
                )}
                {model.rows.length > mainCap && (
                  <p className="mt-3">
                    <Link href={allHref} className="lg-link">
                      Show all {model.rows.length}
                    </Link>
                  </p>
                )}

                {model.view !== "never" && (
                  <section className="lg-never" aria-labelledby="never-title">
                    <h2 id="never-title" className="lg-never-title">
                      <Link href={neverHref} scroll={false} aria-expanded={filters.never} className="lg-never-toggle">
                        {filters.never ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
                        <span className="lg-h2">Never contacted</span>
                        <span className="lg-never-count">
                          <Count value={model.fresh.length} />
                        </span>
                      </Link>
                    </h2>
                    {filters.never && (
                      <>
                        {freshRows.length === 0 ? (
                          <p className="lg-muted py-4">No fresh leads{model.view === "mine" ? " that you hold" : ""}.</p>
                        ) : (
                          <ul className="lg-qlist" aria-label="Never contacted">
                            {freshRows.map(renderRow)}
                          </ul>
                        )}
                        {model.fresh.length > freshCap && (
                          <p className="mt-3">
                            <Link href={demoRoutes.queue(ws, { ...filters, never: true, all: "never" })} className="lg-link">
                              Show all {model.fresh.length}
                            </Link>
                          </p>
                        )}
                      </>
                    )}
                  </section>
                )}
              </div>

              <aside className="lg-keys" aria-label="Keyboard shortcuts">
                <span className="lg-sc">Key</span>
                <span>
                  <kbd>j</kbd> <kbd>k</kbd> move the highlight
                </span>
                <span>
                  <kbd>Enter</kbd> opens the side panel
                </span>
                <span>
                  <kbd>c</kbd> claims
                </span>
                <span>
                  <kbd>l</kbd> logs outreach
                </span>
                <span>
                  <kbd>Esc</kbd> closes the panel
                </span>
                <span>
                  <kbd>/</kbd> searches
                </span>
              </aside>
            </div>
          )}
        </div>
        {panelOpen && inline && panel}
      </div>
      {sheet && panel}
    </div>
  );
}
