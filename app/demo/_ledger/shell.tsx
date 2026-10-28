"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { demoRoutes, matchDemoRoute, type DemoScreen } from "@/demo/routes";
import { useDemoState, useIsMember, useMe, useWorkspace, useWorkspaceStats } from "@/demo/store";
import { boardYear } from "./marks";
import { BoardIcon, ChevronRightIcon, CloseIcon, CompaniesIcon, FactsIcon, ImportIcon, QueueIcon, SearchIcon, SettingsIcon, UserIcon } from "./icons";
import { LogoMark } from "./logo";
import { PaletteProvider, SearchBar, usePalette } from "./palette";
import { useNoteLane } from "./providers";
import { NotFoundPage } from "./not-found-page";
import { UserMenu, UserMenuPanel } from "./user-menu";

const PAGE_NAMES: Partial<Record<DemoScreen, string>> = {
  queue: "Queue",
  board: "Board",
  companies: "Companies",
  company: "Company",
  newCompany: "Add a company",
  import: "Import",
  facts: "Fact sheet",
  settings: "Settings",
};

type Tab = { key: string; label: string; href: (ws: string) => string; icon: ReactNode; active: DemoScreen[] };

const TABS: Tab[] = [
  { key: "queue", label: "Queue", href: (ws) => demoRoutes.queue(ws), icon: <QueueIcon />, active: ["queue"] },
  { key: "board", label: "Board", href: (ws) => demoRoutes.board(ws), icon: <BoardIcon />, active: ["board"] },
  { key: "companies", label: "Companies", href: (ws) => demoRoutes.companies(ws), icon: <CompaniesIcon />, active: ["companies", "company", "newCompany"] },
  { key: "import", label: "Import", href: (ws) => demoRoutes.import(ws), icon: <ImportIcon />, active: ["import"] },
  { key: "facts", label: "Facts", href: (ws) => demoRoutes.facts(ws), icon: <FactsIcon />, active: ["facts"] },
  { key: "settings", label: "Settings", href: (ws) => demoRoutes.settings(ws), icon: <SettingsIcon />, active: ["settings"] },
];

// The status line under the content: live counts from the store, in small caps with tabular figures.
function StatusLine({ ws, claimWindowDays }: { ws: string; claimWindowDays: number }) {
  const stats = useWorkspaceStats(ws);
  const me = useMe(ws);
  const setLane = useNoteLane();
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <footer className="lg-foot" aria-label="Workspace status">
      <div className="lg-notes-lane" ref={setLane} aria-live="polite" aria-atomic="false" />
      <p className="lg-status">
        <span>{plural(stats.total, "company", "companies")}</span>
        <span aria-hidden="true"> &middot; </span>
        <span>{stats.overdue} overdue</span>
        <span aria-hidden="true"> &middot; </span>
        <span>claim window {plural(claimWindowDays, "day", "days")}</span>
        <span aria-hidden="true"> &middot; </span>
        <span>{me.roleLabel} view</span>
      </p>
    </footer>
  );
}

// On a phone the spine gives way to a bottom tab bar: Queue, Board, Search, Companies and More.
// Search opens the palette full screen. More opens a sheet with Import, Facts, Settings and the user menu.
function PhoneTabs({ ws, screen }: { ws: string; screen: DemoScreen }) {
  const { open } = usePalette();
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const link = (key: string, label: string, icon: ReactNode) => {
    const tab = TABS.find((t) => t.key === key) as Tab;
    return (
      <li>
        <Link href={tab.href(ws)} className="lg-tabbar-item" aria-current={tab.active.includes(screen) ? "page" : undefined}>
          {icon}
          <span className="lg-tab-label">{label}</span>
        </Link>
      </li>
    );
  };
  const moreActive = ["import", "facts", "settings"].some((k) => (TABS.find((t) => t.key === k) as Tab).active.includes(screen));
  const closeMore = () => {
    setMore(false);
    requestAnimationFrame(() => moreButton.current?.focus());
  };
  return (
    <>
      <nav className="lg-tabbar" aria-label="Workspace, phone">
        <ul>
          {link("queue", "Queue", <QueueIcon />)}
          {link("board", "Board", <BoardIcon />)}
          <li>
            <button type="button" className="lg-tabbar-item" onClick={open} aria-haspopup="dialog">
              <SearchIcon />
              <span className="lg-tab-label">Search</span>
            </button>
          </li>
          {link("companies", "Companies", <CompaniesIcon />)}
          <li>
            <button
              ref={moreButton}
              type="button"
              className="lg-tabbar-item"
              aria-haspopup="dialog"
              aria-expanded={more}
              aria-current={moreActive ? "page" : undefined}
              onClick={() => setMore(true)}
            >
              <UserIcon />
              <span className="lg-tab-label">More</span>
            </button>
          </li>
        </ul>
      </nav>
      {more && (
        <dialog
          className="lg-more-sheet"
          aria-label="More"
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onCancel={(event) => {
            event.preventDefault();
            closeMore();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMore();
          }}
        >
          <div className="lg-more-body">
            <div className="lg-more-head">
              <h2 className="lg-h3">More</h2>
              <button type="button" className="lg-btn lg-btn-sm" onClick={closeMore} aria-label="Close this sheet">
                <CloseIcon size={16} />
                Close
              </button>
            </div>
            <ul className="lg-more-links">
              {TABS.filter((t) => ["import", "facts", "settings"].includes(t.key)).map((tab) => (
                <li key={tab.key}>
                  <Link
                    href={tab.href(ws)}
                    className="lg-more-link"
                    aria-current={tab.active.includes(screen) ? "page" : undefined}
                    onClick={() => setMore(false)}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    <ChevronRightIcon size={18} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="lg-more-user">
              <UserMenuPanel ws={ws} onClose={() => setMore(false)} />
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

export function WorkspaceShell({ ws, children }: { ws: string; children: ReactNode }) {
  const isMember = useIsMember(ws);
  const workspace = useWorkspace(ws);
  const pathname = usePathname();
  const state = useDemoState();
  const route = matchDemoRoute(pathname);
  const screen = route?.screen ?? "queue";

  // Each page names itself in the tab: "Queue · Boilermaker Robotics Club", or the company's own name.
  // The workspace and company names live in the demo's browser-side state, so the title is set here.
  const companyName = route?.companyId ? state.companies.find((c) => c.id === route.companyId)?.name : undefined;
  const pageTitle = screen === "company" ? (companyName ?? "Company") : (PAGE_NAMES[screen] ?? "Page");
  const bookName = workspace && isMember ? workspace.name : null;
  useEffect(() => {
    document.title = bookName ? `${pageTitle} · ${bookName}` : "Not found · Coppice";
  }, [pageTitle, bookName]);

  if (!workspace || !isMember) return <NotFoundPage />;
  const volume = boardYear(state.now).long;

  return (
    <PaletteProvider ws={ws}>
      <div className="lg-shell">
        <a className="lg-skip" href="#main">
          Skip to the page
        </a>

        <nav className="lg-spine" aria-label="Workspace">
          <div className="lg-spine-mark">
            <Link href={demoRoutes.queue(ws)} aria-label="Coppice, back to the queue">
              <LogoMark size={44} />
            </Link>
          </div>
          <ul className="lg-tabs">
            {TABS.map((tab) => {
              const current = tab.active.includes(screen);
              return (
                <li key={tab.key}>
                  <Link href={tab.href(ws)} className="lg-tab" aria-current={current ? "page" : undefined}>
                    {tab.icon}
                    <span className="lg-tab-label">{tab.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <UserMenu ws={ws} placement="spine" />
        </nav>

        <PhoneTabs ws={ws} screen={screen} />

        <div className="lg-pagecol">
          <div className="lg-bar">
            <Link href={demoRoutes.queue(ws)} className="lg-bar-mark" aria-label="Coppice, back to the queue">
              <LogoMark size={34} />
            </Link>
            <p className="lg-bar-title">{workspace.name}</p>
          </div>

          <header className="lg-head">
            <div className="lg-head-line">
              <p className="lg-book">
                <Link href={demoRoutes.workspaces()} title="Switch workspace">
                  {workspace.name}
                </Link>
                , <em>Volume {volume}</em>
              </p>
              <p className="lg-pagename lg-sc">{PAGE_NAMES[screen] ?? "Page"}</p>
              <SearchBar />
            </div>
            <div className="lg-double-rule" />
          </header>

          <main id="main" tabIndex={-1} className="lg-main">
            {children}
          </main>

          <StatusLine ws={ws} claimWindowDays={workspace.claimWindowDays} />
        </div>
      </div>
    </PaletteProvider>
  );
}
