"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { BoardIcon, ChevronRightIcon, CloseIcon, FactsIcon, ImportIcon, PlusIcon, QueueIcon, SearchIcon, SettingsIcon, StatsIcon, UserIcon } from "./icons";
import { LogoMark } from "./logo";
import { PaletteProvider, SearchBar, usePalette } from "./palette";
import { useNoteLane } from "./providers";
import { UserMenu, UserMenuPanel, type Me } from "./user-menu";
import "./shell.css";

// The shell every signed-in workspace page sits in: a spine with labelled tabs, the book-title
// header with the search that opens the palette, the page, and a status line. On a phone the spine
// gives way to a bottom tab bar. The board serves as the companies view, so a company's own page
// keeps the Board tab lit.

type Screen = "queue" | "board" | "company" | "newCompany" | "import" | "facts" | "stats" | "settings";

function screenOf(pathname: string, workspaceId: string): Screen {
  const rest = pathname.slice(`/${workspaceId}`.length).replace(/\/+$/, "");
  if (rest === "") return "queue";
  if (rest === "/board") return "board";
  if (rest === "/companies/new") return "newCompany";
  if (rest.startsWith("/companies/")) return "company";
  if (rest === "/import") return "import";
  if (rest === "/facts") return "facts";
  if (rest === "/stats") return "stats";
  if (rest === "/settings") return "settings";
  return "queue";
}

const PAGE_NAMES: Record<Screen, string> = {
  queue: "Queue",
  board: "Board",
  company: "Company",
  newCompany: "Add a company",
  import: "Import",
  facts: "Fact sheet",
  stats: "Template stats",
  settings: "Settings",
};

type Tab = { key: string; label: string; path: string; icon: ReactNode; active: Screen[] };

const TABS: Tab[] = [
  { key: "queue", label: "Queue", path: "", icon: <QueueIcon />, active: ["queue"] },
  { key: "board", label: "Board", path: "/board", icon: <BoardIcon />, active: ["board", "company", "newCompany"] },
  { key: "import", label: "Import", path: "/import", icon: <ImportIcon />, active: ["import"] },
  { key: "facts", label: "Facts", path: "/facts", icon: <FactsIcon />, active: ["facts"] },
  { key: "stats", label: "Stats", path: "/stats", icon: <StatsIcon />, active: ["stats"] },
  { key: "settings", label: "Settings", path: "/settings", icon: <SettingsIcon />, active: ["settings"] },
];

export type ShellStats = { companies: number; due: number };

// The status line under the content, from the numbers the layout loaded.
function StatusLine({ stats, claimWindowDays, roleLabel }: { stats: ShellStats; claimWindowDays: number; roleLabel: string }) {
  const setLane = useNoteLane();
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <footer className="lg-foot" aria-label="Workspace status">
      <div className="lg-notes-lane" ref={setLane} aria-live="polite" aria-atomic="false" />
      <p className="lg-status">
        <span>{plural(stats.companies, "company", "companies")}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{stats.due} due</span>
        <span aria-hidden="true">&middot;</span>
        <span>claim window {plural(claimWindowDays, "day", "days")}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{roleLabel} view</span>
      </p>
    </footer>
  );
}

// On a phone the spine gives way to a bottom tab bar: Queue, Board, Search, Facts and More. Search
// opens the palette full screen. More opens a sheet with Import, Add a company, Stats, Settings and the account.
function PhoneTabs({ workspaceId, screen, me }: { workspaceId: string; screen: Screen; me: Me }) {
  const { open } = usePalette();
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const href = (path: string) => `/${workspaceId}${path}`;
  const link = (key: string) => {
    const tab = TABS.find((t) => t.key === key) as Tab;
    return (
      <li>
        <Link href={href(tab.path)} className="lg-tabbar-item" aria-current={tab.active.includes(screen) ? "page" : undefined}>
          {tab.icon}
          <span className="lg-tab-label">{tab.label}</span>
        </Link>
      </li>
    );
  };
  const moreLinks = [
    { key: "import", label: "Import", path: "/import", icon: <ImportIcon />, active: ["import"] as Screen[] },
    { key: "new", label: "Add a company", path: "/companies/new", icon: <PlusIcon />, active: ["newCompany"] as Screen[] },
    { key: "stats", label: "Template stats", path: "/stats", icon: <StatsIcon />, active: ["stats"] as Screen[] },
    { key: "settings", label: "Settings", path: "/settings", icon: <SettingsIcon />, active: ["settings"] as Screen[] },
  ];
  const moreActive = moreLinks.some((l) => l.active.includes(screen));
  const closeMore = () => {
    setMore(false);
    requestAnimationFrame(() => moreButton.current?.focus());
  };
  return (
    <>
      <nav className="lg-tabbar" aria-label="Workspace, phone">
        <ul>
          {link("queue")}
          {link("board")}
          <li>
            <button type="button" className="lg-tabbar-item" onClick={open} aria-haspopup="dialog">
              <SearchIcon />
              <span className="lg-tab-label">Search</span>
            </button>
          </li>
          {link("facts")}
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
              {moreLinks.map((l) => (
                <li key={l.key}>
                  <Link href={href(l.path)} className="lg-more-link" aria-current={l.active.includes(screen) ? "page" : undefined} onClick={() => setMore(false)}>
                    {l.icon}
                    <span>{l.label}</span>
                    <ChevronRightIcon size={18} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="lg-more-user">
              <UserMenuPanel me={me} onClose={() => setMore(false)} />
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

export type ShellProps = {
  workspaceId: string;
  workspaceName: string;
  // "2026-27": the board year the book is for.
  volume: string;
  claimWindowDays: number;
  stats: ShellStats;
  me: Me;
  children: ReactNode;
};

export function WorkspaceShell({ workspaceId, workspaceName, volume, claimWindowDays, stats, me, children }: ShellProps) {
  const screen = screenOf(usePathname(), workspaceId);
  const queueHref = `/${workspaceId}`;

  return (
    <PaletteProvider workspaceId={workspaceId}>
      <div className="lg-shell">
        <a className="lg-skip" href="#main">
          Skip to the page
        </a>

        <nav className="lg-spine" aria-label="Workspace">
          <div className="lg-spine-mark">
            <Link href={queueHref} aria-label="Coppice, back to the queue">
              <LogoMark size={44} />
            </Link>
          </div>
          <ul className="lg-tabs">
            {TABS.map((tab) => (
              <li key={tab.key}>
                <Link href={`/${workspaceId}${tab.path}`} className="lg-tab" aria-current={tab.active.includes(screen) ? "page" : undefined}>
                  {tab.icon}
                  <span className="lg-tab-label">{tab.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <UserMenu me={me} placement="spine" />
        </nav>

        <PhoneTabs workspaceId={workspaceId} screen={screen} me={me} />

        <div className="lg-pagecol">
          <div className="lg-bar">
            <Link href={queueHref} className="lg-bar-mark" aria-label="Coppice, back to the queue">
              <LogoMark size={34} />
            </Link>
            <p className="lg-bar-title">{workspaceName}</p>
          </div>

          <header className="lg-head">
            <div className="lg-head-line">
              <p className="lg-book">
                <Link href="/workspaces" title="Switch workspace">
                  {workspaceName}
                </Link>
                , <span className="lg-book-volume">Volume {volume}</span>
              </p>
              <p className="lg-pagename lg-sc">{PAGE_NAMES[screen]}</p>
              <SearchBar />
            </div>
            <div className="lg-double-rule" />
          </header>

          <main id="main" tabIndex={-1} className="lg-main">
            {children}
          </main>

          <StatusLine stats={stats} claimWindowDays={claimWindowDays} roleLabel={me.roleLabel ?? "Officer"} />
        </div>
      </div>
    </PaletteProvider>
  );
}
