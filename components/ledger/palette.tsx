"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { searchCompanies, type FoundCompany } from "@/app/(app)/[workspaceId]/search-actions";
import { day, daysBetween } from "@/lib/dates";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/stages";
import { BoardIcon, FactsIcon, ImportIcon, PlusIcon, QueueIcon, SearchIcon, SettingsIcon, StageGlyph, UserIcon } from "./icons";
import { OverdueMark } from "./overdue";

// The command palette: an index card on paper with ruled lines. Results are grouped under two
// headers, Companies (found on the server, in this workspace) and Go to (the pages of the app).
// Arrow keys move, Enter runs, Escape closes. It is a modal dialog, so focus stays inside it, and
// focus goes back to where it was when it closes. `/` and Cmd K (Ctrl K elsewhere) open it from any
// workspace screen unless the person is typing in a field. On a phone it fills the screen.

type PaletteApi = { open: () => void };
const PaletteContext = createContext<PaletteApi>({ open: () => undefined });
export const usePalette = (): PaletteApi => useContext(PaletteContext);

const subscribeNothing = () => () => undefined;

// Whether to print the Command key or Ctrl in the keycaps. Server and first paint say Ctrl.
export function useShortcutLabel(): string {
  const apple = useSyncExternalStore(
    subscribeNothing,
    () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  return apple ? "⌘K" : "Ctrl K";
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable));
};

// After the palette sends you to another page, focus goes to that page's heading (or the main region), so
// keyboard and screen reader users start at the top of what they asked for.
function focusPageStart() {
  const main = document.getElementById("main");
  const heading = main?.querySelector<HTMLElement>("h1");
  const target = heading ?? main;
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

export function PaletteProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const pendingPath = useRef<string | null>(null);

  // Runs when the route changes after the palette asked for a navigation.
  useEffect(() => {
    if (pendingPath.current === null || pendingPath.current !== pathname) return;
    pendingPath.current = null;
    const frame = requestAnimationFrame(focusPageStart);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const navigate = useCallback(
    (href: string) => {
      const path = href.split(/[?#]/)[0];
      opener.current = null;
      if (path === window.location.pathname) {
        pendingPath.current = null;
        requestAnimationFrame(focusPageStart);
      } else {
        pendingPath.current = path;
      }
      router.push(href);
    },
    [router],
  );

  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const back = opener.current;
    opener.current = null;
    // Give focus back after the dialog has left, unless the page moved on and the element is gone.
    requestAnimationFrame(() => {
      if (back && back.isConnected && document.activeElement === document.body) back.focus();
    });
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.isComposing) return;
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey;
      const chord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!slash && !chord) return;
      if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  const api = useMemo(() => ({ open: show }), [show]);
  return (
    <PaletteContext.Provider value={api}>
      {children}
      {open && <CommandPalette workspaceId={workspaceId} onClose={close} onNavigate={navigate} />}
    </PaletteContext.Provider>
  );
}

// The always-visible search bar in the page header. A button that opens the palette.
export function SearchBar({ className = "" }: { className?: string }) {
  const { open } = usePalette();
  const shortcut = useShortcutLabel();
  return (
    <button type="button" className={`lg-searchbar ${className}`} onClick={open} aria-haspopup="dialog" aria-keyshortcuts="/ Meta+K Control+K">
      <SearchIcon size={18} />
      <span className="lg-searchbar-text">Search companies or pages</span>
      <span className="lg-keycaps" aria-hidden="true">
        <kbd>/</kbd>
        <kbd>{shortcut}</kbd>
      </span>
    </button>
  );
}

// ----- What the palette lists -----

type PageItem = { kind: "page"; key: string; label: string; hint: string; href: string; words: string; icon: ReactNode };
type CompanyItem = { kind: "company"; key: string; company: FoundCompany; href: string };
type Item = PageItem | CompanyItem;
type Group = { id: "companies" | "pages"; title: string; items: Item[] };

function pageItems(workspaceId: string, query: string): PageItem[] {
  const base = `/${workspaceId}`;
  const pages: PageItem[] = [
    { kind: "page", key: "queue", label: "Go to Queue", hint: "Follow-ups that are due", href: base, words: "queue home due follow-ups today", icon: <QueueIcon size={18} /> },
    { kind: "page", key: "board", label: "Go to Board", hint: "Companies by stage", href: `${base}/board`, words: "board stages companies pipeline", icon: <BoardIcon size={18} /> },
    { kind: "page", key: "new", label: "Add a company", hint: "New company", href: `${base}/companies/new`, words: "add new create company", icon: <PlusIcon size={18} /> },
    { kind: "page", key: "import", label: "Go to Import", hint: "Bring in a CSV", href: `${base}/import`, words: "import csv spreadsheet upload sheet", icon: <ImportIcon size={18} /> },
    { kind: "page", key: "facts", label: "Go to Facts", hint: "The fact sheet", href: `${base}/facts`, words: "facts fact sheet packet pdf ai verify", icon: <FactsIcon size={18} /> },
    { kind: "page", key: "settings", label: "Go to Settings", hint: "Members and claim window", href: `${base}/settings`, words: "settings members invite claim window ai owner", icon: <SettingsIcon size={18} /> },
    { kind: "page", key: "workspaces", label: "Switch workspace", hint: "Your workspaces", href: "/workspaces", words: "switch workspace workspaces club team", icon: <UserIcon size={18} /> },
  ];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = tokens.length === 0 ? pages : pages.filter((p) => tokens.every((t) => `${p.label} ${p.words}`.toLowerCase().includes(t)));
  const text = query.trim().slice(0, 100);
  // Filtering the board is a real thing the board does with ?q=.
  if (text) {
    found.push({
      kind: "page",
      key: "board-filter",
      label: `Filter the board for "${text}"`,
      hint: "Board search",
      href: `${base}/board?q=${encodeURIComponent(text)}`,
      words: "",
      icon: <BoardIcon size={18} />,
    });
  }
  return found;
}

function CommandPalette({ workspaceId, onClose, onNavigate }: { workspaceId: string; onClose: () => void; onNavigate: (href: string) => void }) {
  const shortcut = useShortcutLabel();
  const onBoard = usePathname() === `/${workspaceId}/board`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<{ query: string; companies: FoundCompany[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const requests = useRef(0);

  const text = query.trim();

  // Company search: a short pause after typing, then one read on the server. A slow answer to an
  // earlier text never replaces the answer to the current one.
  useEffect(() => {
    if (!text) return;
    const mine = ++requests.current;
    const timer = window.setTimeout(() => {
      searchCompanies(workspaceId, text)
        .then((result) => {
          if (mine !== requests.current) return;
          if (result.ok) {
            setFailed(false);
            setFound({ query: text, companies: result.data });
          } else {
            setFailed(true);
          }
        })
        .catch(() => {
          if (mine === requests.current) setFailed(true);
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [text, workspaceId]);

  const groups = useMemo<Group[]>(() => {
    const companies: CompanyItem[] =
      text && found?.query === text
        ? found.companies.map((company) => ({ kind: "company", key: `c-${company.id}`, company, href: `/${workspaceId}/companies/${company.id}` }))
        : [];
    const pages = pageItems(workspaceId, query);
    // On the board, "Filter the board" is the first thing offered for typed text.
    const ordered = onBoard ? [...pages.filter((p) => p.key === "board-filter"), ...pages.filter((p) => p.key !== "board-filter")] : pages;
    const out: Group[] = [];
    if (companies.length > 0) out.push({ id: "companies", title: "Companies", items: companies });
    if (ordered.length > 0) out.push({ id: "pages", title: "Go to", items: ordered });
    return out;
  }, [found, text, query, workspaceId, onBoard]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const optionId = (index: number) => `${id}-opt-${index}`;
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const searching = text !== "" && found?.query !== text && !failed;

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, groups]);

  const run = (item: Item) => {
    onClose();
    onNavigate(item.href);
  };

  const onKey = (event: KeyboardEvent) => {
    // Keep Tab inside the card: the search field and the close button are the only stops.
    if (event.key === "Tab") {
      const stops = Array.from(dialog.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.target !== input.current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(flat.length === 0 ? 0 : (current + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[current];
      if (item) run(item);
    }
  };

  const total = flat.length;
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, x) => n + x.items.length, 0));
  return (
    <dialog
      ref={dialog}
      className="lg-pal"
      aria-label="Search and go to"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onKeyDown={onKey}
    >
      <div className="lg-pal-card">
        <div className="lg-pal-field">
          <SearchIcon size={20} />
          <label className="lg-sr" htmlFor={`${id}-input`}>
            Search companies or pages
          </label>
          <input
            ref={input}
            id={`${id}-input`}
            type="text"
            role="combobox"
            className="lg-pal-input"
            placeholder="Search companies or pages"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={total > 0 ? optionId(current) : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <button type="button" className="lg-pal-close" onClick={onClose} aria-label="Close search">
            <span aria-hidden="true">Esc</span>
          </button>
        </div>

        <div id={`${id}-list`} ref={list} role="listbox" aria-label="Results" className="lg-pal-list" tabIndex={-1}>
          {groups.map((group, g) => (
            <div key={group.id} role="group" aria-labelledby={`${id}-g-${group.id}`}>
              <p id={`${id}-g-${group.id}`} className="lg-pal-head lg-sc">
                {group.title}
              </p>
              {group.items.map((item, n) => {
                const i = starts[g] + n;
                return (
                  <div
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    data-index={i}
                    data-active={i === current || undefined}
                    className="lg-pal-opt"
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={() => run(item)}
                  >
                    <span className="lg-pal-ico">{item.kind === "company" ? <StageGlyph stage={item.company.stage} size={18} /> : item.icon}</span>
                    <span className="lg-pal-main">
                      {item.kind === "company" ? (
                        <>
                          <span className="lg-pal-title">{item.company.name}</span>
                          <span className="lg-pal-sub">
                            {STAGE_LABELS[item.company.stage]}
                            {item.company.matchedOn === "name" ? "" : `, matched on ${item.company.matchedOn}`}
                          </span>
                        </>
                      ) : (
                        <span className="lg-pal-title">{item.label}</span>
                      )}
                    </span>
                    <span className="lg-pal-meta">
                      {item.kind === "company" ? <DueMark company={item.company} /> : <span className="lg-muted">{item.hint}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {searching && total === 0 && <p className="lg-pal-none">Searching...</p>}
          {failed && <p className="lg-pal-none">Company search did not answer. The pages above still work.</p>}
          {!searching && !failed && text !== "" && found?.query === text && found.companies.length === 0 && (
            <p className="lg-pal-none">No company matches &ldquo;{text}&rdquo;. Try part of a name, a website or an industry.</p>
          )}
        </div>

        <p className="lg-sr" role="status" aria-live="polite">
          {text && found?.query === text ? `${found.companies.length} ${found.companies.length === 1 ? "company" : "companies"} found` : ""}
        </p>

        <div className="lg-pal-foot">
          <span>
            <kbd>Up</kbd> <kbd>Down</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> opens
          </span>
          <span>
            <kbd>Esc</kbd> closes
          </span>
          <span className="lg-pal-foot-end">
            <kbd>{shortcut}</kbd> opens this from any page
          </span>
        </div>
      </div>
    </dialog>
  );
}

// When a company's follow-up is due, with the same levels the queue uses. Closed companies have none.
function DueMark({ company }: { company: FoundCompany }) {
  if (TERMINAL_STAGES.includes(company.stage) || !company.nextFollowUpAt) return <span className="lg-muted">No follow-up</span>;
  const due = new Date(company.nextFollowUpAt);
  return <OverdueMark days={daysBetween(due, new Date())} dueOn={day(due)} size={14} />;
}
