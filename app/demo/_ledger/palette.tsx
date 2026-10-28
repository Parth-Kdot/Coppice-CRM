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
import { demoRoutes, matchDemoRoute } from "@/demo/routes";
import { useBoardFilters, useDemoActions, useDemoState, useMe } from "@/demo/store";
import { STAGE_LABELS } from "@/demo/types";
import { useResetDemo } from "./demo-tools";
import { BoardIcon, ChevronRightIcon, ClaimIcon, LogIcon, ResetIcon, SearchIcon, StageGlyph, UserIcon } from "./icons";
import { searchPalette, type PaletteItem, type PaletteRoutes } from "./palette-search";
import { useMoveStage, useNotify } from "./providers";
import { OverdueMark } from "./screens/overdue";
import { useClaimAction } from "./screens/shared";

// The command palette: an index card on paper with ruled lines. Results are grouped under small caps
// headers (Companies, People, Actions) and company and people results say what they matched on.
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

export function PaletteProvider({ ws, children }: { ws: string; children: ReactNode }) {
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
      {open && <CommandPalette ws={ws} onClose={close} onNavigate={navigate} />}
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
      <span className="lg-searchbar-text">Search companies, people or actions</span>
      <span className="lg-keycaps" aria-hidden="true">
        <kbd>/</kbd>
        <kbd>{shortcut}</kbd>
      </span>
    </button>
  );
}

function ItemIcon({ item }: { item: PaletteItem }) {
  if (item.kind === "company") return <StageGlyph stage={item.company.stage} size={18} />;
  if (item.kind === "person") return <UserIcon size={18} />;
  switch (item.target.type) {
    case "claim":
      return <ClaimIcon size={18} />;
    case "log":
      return <LogIcon size={18} />;
    case "move":
      return <BoardIcon size={18} />;
    case "role":
      return <UserIcon size={18} />;
    case "reset":
      return <ResetIcon size={18} />;
    default:
      return <ChevronRightIcon size={18} />;
  }
}

function CommandPalette({ ws, onClose, onNavigate }: { ws: string; onClose: () => void; onNavigate: (href: string) => void }) {
  const state = useDemoState();
  const actions = useDemoActions();
  const me = useMe(ws);
  const notify = useNotify();
  const moveStage = useMoveStage();
  const reset = useResetDemo(ws);
  const { claim } = useClaimAction(ws);
  const shortcut = useShortcutLabel();
  // On the board the palette and the board's search box share one query: it opens with what the box
  // holds, and "Filter the board" writes what was typed back to the box.
  const onBoard = matchDemoRoute(usePathname())?.screen === "board";
  const boardFilters = useBoardFilters();
  const [query, setQuery] = useState(onBoard ? boardFilters.q : "");
  const [active, setActive] = useState(0);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const routes = useMemo<PaletteRoutes>(
    () => ({
      queue: demoRoutes.queue(ws),
      board: demoRoutes.board(ws),
      companies: demoRoutes.companies(ws),
      newCompany: demoRoutes.newCompany(ws),
      import: demoRoutes.import(ws),
      facts: demoRoutes.facts(ws),
      settings: demoRoutes.settings(ws),
      company: (companyId, anchor) => demoRoutes.company(ws, companyId, anchor ? { anchor } : undefined),
    }),
    [ws],
  );

  const groups = useMemo(() => {
    const found = searchPalette(state, ws, query, routes, me.role);
    const text = query.trim().slice(0, 100);
    if (!onBoard || (!text && !boardFilters.q)) return found;
    const item: PaletteItem = text
      ? { kind: "action", key: "board-filter", label: `Filter the board for "${text}"`, hint: "Board search", target: { type: "go", href: demoRoutes.board(ws, { ...boardFilters, q: text, all: null }) } }
      : { kind: "action", key: "board-filter-clear", label: `Clear the board search "${boardFilters.q}"`, hint: "Board search", target: { type: "go", href: demoRoutes.board(ws, { ...boardFilters, q: "", all: null }) } };
    const actions = found.find((g) => g.id === "actions");
    if (!actions) return [...found, { id: "actions" as const, title: "Actions", items: [item] }];
    return found.map((g) => (g === actions ? { ...g, items: [item, ...g.items] } : g));
  }, [state, ws, query, routes, me.role, onBoard, boardFilters]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const optionId = (index: number) => `${id}-opt-${index}`;
  const current = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, groups]);

  const run = (item: PaletteItem) => {
    onClose();
    if (item.kind !== "action") {
      onNavigate(item.href);
      return;
    }
    const target = item.target;
    switch (target.type) {
      case "go":
        onNavigate(target.href);
        break;
      case "log":
        onNavigate(routes.company(target.companyId, "logOutreach"));
        break;
      case "claim": {
        const result = claim(target.companyId, target.name);
        if (!result.ok) notify(result.error, "error");
        break;
      }
      case "move":
        void moveStage({ ws, companyId: target.companyId, companyName: target.name, to: target.to });
        break;
      case "role":
        actions.setRole(target.role, ws);
        notify(target.role === "owner" ? "Now viewing as an Owner." : "Now viewing as an Officer.");
        break;
      case "reset":
        reset();
        break;
    }
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
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      setActive(Math.max(0, flat.length - 1));
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
      aria-label="Search and commands"
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
            Search companies, people or actions
          </label>
          <input
            ref={input}
            id={`${id}-input`}
            type="text"
            role="combobox"
            className="lg-pal-input"
            placeholder="Search companies, people or actions"
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
            <div key={group.id} role="group" aria-labelledby={`${id}-g-${group.id}`} className="lg-pal-group">
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
                    <span className="lg-pal-ico">
                      <ItemIcon item={item} />
                    </span>
                    <span className="lg-pal-main">
                      {item.kind === "company" && (
                        <>
                          <span className="lg-pal-title">{item.company.name}</span>
                          <span className="lg-pal-sub">
                            {STAGE_LABELS[item.company.stage]}
                            {item.matched ? `, ${item.matched}` : ""}
                          </span>
                        </>
                      )}
                      {item.kind === "person" && (
                        <>
                          <span className="lg-pal-title">{item.contact.name}</span>
                          <span className="lg-pal-sub">
                            {item.contact.title ? `${item.contact.title}, ` : ""}
                            {item.matched}
                          </span>
                        </>
                      )}
                      {item.kind === "action" && <span className="lg-pal-title">{item.label}</span>}
                    </span>
                    <span className="lg-pal-meta">
                      {item.kind === "company" &&
                        (item.days !== null ? (
                          <OverdueMark days={item.days} dueOn={item.dueOn ?? undefined} size={14} />
                        ) : (
                          <span className="lg-muted">No follow-up</span>
                        ))}
                      {item.kind === "person" && <span className="lg-muted">{item.company.name}</span>}
                      {item.kind === "action" && <span className="lg-muted">{item.hint}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {total === 0 && (
            <p className="lg-pal-none">Nothing matches &ldquo;{query.trim()}&rdquo;. Try a company name, a contact or a word like claim or board.</p>
          )}
        </div>

        <p className="lg-sr" role="status" aria-live="polite">
          {query.trim() ? `${total} ${total === 1 ? "result" : "results"}` : ""}
        </p>

        <div className="lg-pal-foot">
          <span>
            <kbd>Up</kbd> <kbd>Down</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> runs
          </span>
          <span>
            <kbd>Esc</kbd> closes
          </span>
          <span className="lg-pal-foot-end">
            <kbd>{shortcut}</kbd> opens this from any screen
          </span>
        </div>
      </div>
    </dialog>
  );
}
