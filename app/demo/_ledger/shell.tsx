"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { demoRoutes, matchDemoRoute, type DemoScreen } from "@/demo/routes";
import { useDemoState, useIsMember, useMe, useWorkspace, useWorkspaceStats } from "@/demo/store";
import { boardYear } from "./marks";
import { BoardIcon, CompaniesIcon, FactsIcon, ImportIcon, QueueIcon, SettingsIcon } from "./icons";
import { LogoMark } from "./logo";
import { PaletteProvider, SearchBar } from "./palette";
import { NotFoundPage } from "./not-found-page";
import { UserMenu } from "./user-menu";

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
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <footer className="lg-status" aria-label="Workspace status">
      <p>
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

export function WorkspaceShell({ ws, children }: { ws: string; children: ReactNode }) {
  const isMember = useIsMember(ws);
  const workspace = useWorkspace(ws);
  const pathname = usePathname();
  const state = useDemoState();
  if (!workspace || !isMember) return <NotFoundPage />;

  const route = matchDemoRoute(pathname);
  const screen = route?.screen ?? "queue";
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

        <div className="lg-pagecol">
          <div className="lg-bar">
            <Link href={demoRoutes.queue(ws)} className="lg-bar-mark" aria-label="Coppice, back to the queue">
              <LogoMark size={34} />
            </Link>
            <p className="lg-bar-title">{workspace.name}</p>
            <UserMenu ws={ws} placement="bar" />
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
