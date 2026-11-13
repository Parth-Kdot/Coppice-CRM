"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BoardIcon, CapsuleIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, FactsIcon, ImportIcon, MoreIcon, PlusIcon, QueueIcon, SearchIcon, SettingsIcon, StatsIcon } from "./icons";
import { LogoMark } from "@/components/brand/logo";
import { PaletteProvider, SearchBar, usePalette } from "./palette";
import { useNoteLane } from "./providers";
import { initialsOf, UserMenu, UserMenuPanel, type Me } from "./user-menu";
import { WorkspaceSwitcher, type WorkspaceChoice } from "./workspace-switcher";
import "./shell.css";

// The shell every signed-in workspace page sits in: a spine with five labelled tabs (Queue, Board,
// Import, Facts, Settings) and the account button, one header (the workspace name as a switcher, and
// the search that opens the palette), and the page. Feedback is written in a fixed lane at the
// bottom that is empty when idle. On a phone the spine gives way to a bottom bar: Queue, Board,
// Search, + Add (a small sheet: Add a company, Import) and More (Facts, Template stats, Time Capsule, Settings and
// the account). A company page lights the list tab you came from (queue or board).

type Screen = "queue" | "board" | "company" | "newCompany" | "import" | "facts" | "stats" | "capsule" | "settings";

function screenOf(pathname: string, workspaceId: string): Screen {
  const rest = pathname.slice(`/${workspaceId}`.length).replace(/\/+$/, "");
  if (rest === "") return "queue";
  if (rest === "/board") return "board";
  if (rest === "/companies/new") return "newCompany";
  if (rest.startsWith("/companies/")) return "company";
  if (rest === "/import") return "import";
  if (rest === "/facts") return "facts";
  if (rest === "/stats") return "stats";
  if (rest === "/capsule") return "capsule";
  if (rest === "/settings") return "settings";
  return "queue";
}

// ----- The list tab a company page lights: the one you came from (sessionStorage, per tab) -----

const LIST_KEY = "lg-list-tab";
type ListTab = "queue" | "board";
// A company page opened straight from a link (nothing stored) belongs to the queue, the home page.
const readListTab = (): ListTab => {
  try {
    return window.sessionStorage.getItem(LIST_KEY) === "board" ? "board" : "queue";
  } catch {
    return "queue";
  }
};
const subscribeNothing = () => () => undefined;

function useListTab(screen: Screen): ListTab {
  useEffect(() => {
    if (screen !== "queue" && screen !== "board") return;
    try {
      window.sessionStorage.setItem(LIST_KEY, screen);
    } catch {
      // Storage blocked: company pages light Queue.
    }
  }, [screen]);
  return useSyncExternalStore(subscribeNothing, readListTab, () => "queue");
}

// The company page's way back: to the list the spine lights (the one you came from), so the two
// always agree.
export function BackToList({ workspaceId, className, icon }: { workspaceId: string; className?: string; icon?: ReactNode }) {
  const tab = useSyncExternalStore(subscribeNothing, readListTab, () => "queue" as ListTab);
  return (
    <Link href={tab === "board" ? `/${workspaceId}/board` : `/${workspaceId}`} className={className}>
      {icon}
      {tab === "board" ? "Board" : "Queue"}
    </Link>
  );
}

type Tab = { key: string; label: string; path: string; icon: ReactNode; tour: string };

const TABS: Tab[] = [
  { key: "queue", label: "Queue", path: "", icon: <QueueIcon />, tour: "nav-queue" },
  { key: "board", label: "Board", path: "/board", icon: <BoardIcon />, tour: "nav-board" },
  { key: "import", label: "Import", path: "/import", icon: <ImportIcon />, tour: "nav-import" },
  { key: "facts", label: "Facts", path: "/facts", icon: <FactsIcon />, tour: "nav-facts" },
  { key: "settings", label: "Settings", path: "/settings", icon: <SettingsIcon />, tour: "nav-settings" },
];

function litTab(screen: Screen, listTab: ListTab): string | null {
  if (screen === "company") return listTab;
  if (screen === "queue" || screen === "board" || screen === "import" || screen === "facts" || screen === "settings") return screen;
  return null;
}

// A tab dims and pulses while its page is on the way (useLinkStatus), so a slow click is never silent.
function TabPending() {
  const { pending } = useLinkStatus();
  return <span className="lg-tab-pend" data-pending={pending || undefined} aria-hidden="true" />;
}

// ----- After a route change, focus goes to the new page's heading -----

// Waits for the page's h1 (a loading skeleton may come first), unless the person has moved focus
// on meanwhile. Skipped on the first load. When the address has a hash ("#log-outreach") that
// part of the page takes focus instead (the browser has already scrolled to it).
function useFocusHeadingOnRouteChange(pathname: string) {
  // The path last handled: the first load (and React's development double run of effects) is not a change.
  const seen = useRef(pathname);
  useEffect(() => {
    if (seen.current === pathname) return;
    seen.current = pathname;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const start = document.activeElement;
    let frames = 0;
    let raf = 0;
    const attempt = () => {
      const active = document.activeElement;
      if (active && active !== start && active !== document.body) return;
      // The onboarding tour moved to this page and its card has focus: leave it there.
      if (active?.closest("[data-tour-card]")) return;
      const target = (hash && document.getElementById(hash)) || document.querySelector<HTMLElement>("#main h1");
      if (target) {
        if (!target.hasAttribute("tabindex") && !target.matches("a[href], button, input, select, textarea, summary")) target.tabIndex = -1;
        target.focus({ preventScroll: true });
        return;
      }
      // About three seconds at 60 frames a second, then the main region itself.
      if (++frames < 180) raf = requestAnimationFrame(attempt);
      else document.getElementById("main")?.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [pathname]);
}

// ----- Phone: a bottom sheet (the + Add sheet and the More sheet) -----

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <dialog
      className="lg-more-sheet"
      aria-label={label}
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lg-more-body">
        <div className="lg-more-head">
          <h2 className="lg-h3">{label}</h2>
          <button type="button" className="lg-btn lg-btn-sm" onClick={onClose} aria-label="Close this sheet">
            <CloseIcon size={16} />
            Close
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

type SheetLink = { key: string; label: string; path: string; icon: ReactNode; screens: Screen[] };

function PhoneTabs({ workspaceId, workspaceName, screen, listTab, me, accountItems }: { workspaceId: string; workspaceName: string; screen: Screen; listTab: ListTab; me: Me; accountItems?: ReactNode }) {
  const { open } = usePalette();
  const [sheet, setSheet] = useState<"add" | "more" | null>(null);
  const [account, setAccount] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const href = (path: string) => `/${workspaceId}${path}`;
  const lit = litTab(screen, listTab);

  const addLinks: SheetLink[] = [
    { key: "new", label: "Add a company", path: "/companies/new", icon: <PlusIcon />, screens: ["newCompany"] },
    { key: "import", label: "Import a spreadsheet", path: "/import", icon: <ImportIcon />, screens: ["import"] },
  ];
  const moreLinks: SheetLink[] = [
    { key: "facts", label: "Facts", path: "/facts", icon: <FactsIcon />, screens: ["facts"] },
    { key: "stats", label: "Template stats", path: "/stats", icon: <StatsIcon />, screens: ["stats"] },
    { key: "capsule", label: "Time Capsule", path: "/capsule", icon: <CapsuleIcon />, screens: ["capsule"] },
    { key: "settings", label: "Settings", path: "/settings", icon: <SettingsIcon />, screens: ["settings"] },
  ];
  const addActive = addLinks.some((l) => l.screens.includes(screen));
  const moreActive = moreLinks.some((l) => l.screens.includes(screen));

  const close = () => {
    const back = sheet === "add" ? addButton.current : moreButton.current;
    setSheet(null);
    setAccount(false);
    requestAnimationFrame(() => back?.focus());
  };
  // A link was followed: the sheet goes, and focus moves with the new page (the shell's h1 focus).
  const leave = () => {
    setSheet(null);
    setAccount(false);
  };

  const tabLink = (tab: Tab) => (
    <li>
      <Link href={href(tab.path)} className="lg-tabbar-item" aria-current={lit === tab.key ? "page" : undefined} data-tour={tab.tour}>
        {tab.icon}
        <span className="lg-tab-label">{tab.label}</span>
        <TabPending />
      </Link>
    </li>
  );
  const sheetLinks = (links: SheetLink[]) => (
    <ul className="lg-more-links">
      {links.map((l) => (
        <li key={l.key}>
          <Link href={href(l.path)} className="lg-more-link" aria-current={l.screens.includes(screen) ? "page" : undefined} onClick={leave}>
            {l.icon}
            <span>{l.label}</span>
            <ChevronRightIcon size={18} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <nav className="lg-tabbar" aria-label="Workspace, phone">
        <ul>
          {tabLink(TABS[0])}
          {tabLink(TABS[1])}
          <li>
            <button type="button" className="lg-tabbar-item" onClick={open} aria-haspopup="dialog" data-tour="search-tab">
              <SearchIcon />
              <span className="lg-tab-label">Search</span>
            </button>
          </li>
          <li>
            <button
              ref={addButton}
              type="button"
              className="lg-tabbar-item"
              aria-haspopup="dialog"
              aria-expanded={sheet === "add"}
              aria-current={addActive ? "page" : undefined}
              data-tour="tab-add"
              onClick={() => setSheet("add")}
            >
              <PlusIcon />
              <span className="lg-tab-label">Add</span>
            </button>
          </li>
          <li>
            <button
              ref={moreButton}
              type="button"
              className="lg-tabbar-item"
              aria-haspopup="dialog"
              aria-expanded={sheet === "more"}
              aria-current={moreActive ? "page" : undefined}
              onClick={() => setSheet("more")}
            >
              <MoreIcon />
              <span className="lg-tab-label">More</span>
            </button>
          </li>
        </ul>
      </nav>
      {sheet === "add" && (
        <Sheet label="Add" onClose={close}>
          {sheetLinks(addLinks)}
        </Sheet>
      )}
      {sheet === "more" && (
        <Sheet label="More" onClose={close}>
          <div className="lg-acct">
            <button
              type="button"
              className="lg-acct-row"
              aria-expanded={account}
              aria-controls="lg-acct-panel"
              data-tour="account-menu"
              onClick={() => setAccount((v) => !v)}
            >
              <span className="lg-acct-initials" aria-hidden="true">
                {initialsOf(me.name)}
              </span>
              <span className="lg-acct-text">
                <span className="lg-acct-name lg-trunc">{me.name}</span>
                <span className="lg-acct-ws lg-trunc">{workspaceName}</span>
              </span>
              <ChevronDownIcon size={18} className="lg-acct-chev" />
              <span className="lg-sr">, account</span>
            </button>
            <div id="lg-acct-panel" className="lg-acct-panel" hidden={!account}>
              <UserMenuPanel me={me} showName={false} onClose={leave} extraItems={accountItems} />
            </div>
          </div>
          {sheetLinks(moreLinks)}
        </Sheet>
      )}
    </>
  );
}

// The lane margin notes are written in: fixed at the bottom of the page column, empty when idle.
function NoteLane() {
  const setLane = useNoteLane();
  return <div className="lg-notes-lane" ref={setLane} aria-live="polite" aria-atomic="false" />;
}

export type ShellProps = {
  workspaceId: string;
  workspaceName: string;
  // The person's workspaces, for the header's switcher (at most 20).
  workspaces: WorkspaceChoice[];
  // "2026-27": the board year the book is for, printed after the workspace name like a volume.
  volume?: string;
  me: Me;
  // Drawn after the shell, inside the palette's provider (the onboarding tour).
  overlay?: ReactNode;
  // Extra rows in the account menu and the phone's account row ("Replay the basics").
  accountItems?: ReactNode;
  children: ReactNode;
};

export function WorkspaceShell({ workspaceId, workspaceName, workspaces, volume, me, overlay, accountItems, children }: ShellProps) {
  const pathname = usePathname();
  const screen = screenOf(pathname, workspaceId);
  const listTab = useListTab(screen);
  const lit = litTab(screen, listTab);
  const queueHref = `/${workspaceId}`;
  useFocusHeadingOnRouteChange(pathname);

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
                <Link href={`/${workspaceId}${tab.path}`} className="lg-tab" aria-current={lit === tab.key ? "page" : undefined} data-tour={tab.tour}>
                  {tab.icon}
                  <span className="lg-tab-label">{tab.label}</span>
                  <TabPending />
                </Link>
              </li>
            ))}
          </ul>
          <UserMenu me={me} placement="spine" extraItems={accountItems} />
        </nav>

        <PhoneTabs workspaceId={workspaceId} workspaceName={workspaceName} screen={screen} listTab={listTab} me={me} accountItems={accountItems} />

        <div className="lg-pagecol">
          <header className="lg-head">
            <div className="lg-bar">
              <Link href={queueHref} className="lg-bar-mark" aria-label="Coppice, back to the queue">
                <LogoMark size={34} />
              </Link>
              <WorkspaceSwitcher current={workspaceId} name={workspaceName} workspaces={workspaces} variant="bar" />
            </div>
            <div className="lg-head-line">
              <div className="lg-book">
                <WorkspaceSwitcher current={workspaceId} name={workspaceName} workspaces={workspaces} />
                {volume && <span className="lg-book-volume">Volume {volume}</span>}
              </div>
              <SearchBar />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="lg-main">
            {children}
          </main>

          <NoteLane />
        </div>
      </div>
      {overlay}
    </PaletteProvider>
  );
}
