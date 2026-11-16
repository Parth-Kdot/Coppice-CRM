"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { CloseIcon, SearchIcon } from "@/components/ledger/icons";
import { focusSoon } from "@/components/ledger/focus";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import type { OverflowItem } from "@/components/ledger/overflow-menu";
import { boardQuery, type BoardFilters } from "@/lib/limits";

type Props = {
  filters: BoardFilters;
  industries: string[];
  // The industry filter only shows once there are enough companies for it to help (or one is set).
  showFilter: boolean;
  // The ⋯ menu and the other toolbar buttons, drawn at the end of the toolbar. On a phone the
  // industry filter is a choice in that menu, so the menu is built here, next to the filter's state:
  // it gets the extra items and a note for its accessible name when a filter is on.
  renderEnd: (menu: { items: OverflowItem[]; note: string }) => ReactNode;
};

const PHONE = "(max-width: 760px)";
const subscribePhone = (notify: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const isPhone = () => window.matchMedia(PHONE).matches;

// Search box and industry filter. They only change the URL; the server renders the board for it,
// so a filtered board can be bookmarked and Back works. Typing waits 300 ms after the last key so
// each keystroke doesn't load the board.
//
// Both hold their own value, so a pick shows at once while the server catches up, and both follow
// the URL when it changes some other way (the Board tab, Back, Forward): a URL value this box
// pushed itself is not echoed back into it, so typing on while a search loads is never undone.
//
// On a phone (760 px and narrower) the toolbar is compact: the search is an icon button that opens
// the field on its own line (focus moves into it; Escape, or its clear button, empties it and closes
// it; while there is a search the field stays open), and the industry choice lives in the ⋯ menu,
// with the active industry shown as a chip that clears it. The URL is the same either way.
export function BoardSearch({ filters, industries, showFilter, renderEnd }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(filters.q);
  const [industry, setIndustry] = useState(filters.industry);
  // The URL's values as last seen, and the values this component pushed that haven't arrived yet.
  const [seen, setSeen] = useState({ q: filters.q, industry: filters.industry });
  const [pushed, setPushed] = useState<{ q: string[]; industry: string[] }>({ q: [], industry: [] });
  // Bumped when the URL's search changes from elsewhere: a search still waiting to be sent is dropped.
  const [outside, setOutside] = useState(0);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Phone only: the field was opened by the button. A search in the box keeps it open regardless.
  const [opened, setOpened] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const open = opened || text !== "";

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (outside > 0) clearTimeout(timer.current);
  }, [outside]);

  // The URL changed: adopt it unless it is one of ours arriving.
  if (filters.q !== seen.q || filters.industry !== seen.industry) {
    setSeen({ q: filters.q, industry: filters.industry });
    const ownQ = pushed.q.indexOf(filters.q);
    const ownIndustry = pushed.industry.indexOf(filters.industry);
    if (filters.q !== seen.q && ownQ === -1) {
      setText(filters.q);
      setOutside((n) => n + 1);
    }
    if (filters.industry !== seen.industry && ownIndustry === -1) setIndustry(filters.industry);
    setPushed({
      q: ownQ === -1 ? pushed.q : pushed.q.slice(ownQ + 1),
      industry: ownIndustry === -1 ? pushed.industry : pushed.industry.slice(ownIndustry + 1),
    });
  }

  // A new search starts over: columns go back to their first 50 cards, and no sheet stays open.
  const go = (changes: { q?: string; industry?: string }) => {
    const next = { q: changes.q ?? text.trim(), industry: changes.industry ?? industry };
    setPushed((p) => ({ q: [...p.q, next.q].slice(-8), industry: [...p.industry, next.industry].slice(-8) }));
    startTransition(() => router.replace(`${pathname}${boardQuery({ ...filters, ...next, all: null, archived: false, dupes: false })}`, { scroll: false }));
  };

  const options = [{ value: "", label: "All industries" }, ...industries.map((i) => ({ value: i, label: i }))];
  const pickIndustry = (value: string) => {
    if (value === industry) return;
    setIndustry(value);
    go({ industry: value });
  };
  // Escape or the clear button: the search is dropped, the field closes and focus returns to its button.
  const closeSearch = () => {
    clearTimeout(timer.current);
    setOpened(false);
    if (text !== "") {
      setText("");
      go({ q: "" });
    }
    toggle.current?.focus();
  };
  const industryItems: OverflowItem[] =
    phone && showFilter ? options.map((o) => ({ key: `industry-${o.value || "all"}`, label: o.label, group: "Industry", checked: o.value === industry, onSelect: () => pickIndustry(o.value) })) : [];

  return (
    <>
      {/* Phone only (the stylesheet hides it elsewhere): opens the search field. */}
      <button
        ref={toggle}
        type="button"
        className="lg-btn lg-bsearch-btn"
        aria-label={text !== "" ? `Search companies, searching for ${text}` : "Search companies"}
        aria-expanded={open}
        aria-controls="board-search-form"
        data-active={text !== "" || undefined}
        onClick={() => {
          if (!open) {
            setOpened(true);
            // The field is drawn on this render; focus it once it is.
            requestAnimationFrame(() => input.current?.focus());
          } else if (text !== "") input.current?.focus();
          else {
            setOpened(false);
          }
        }}
      >
        <SearchIcon size={18} />
      </button>
      <form
        id="board-search-form"
        className="lg-bsearch"
        role="search"
        data-open={open || undefined}
        onSubmit={(e) => e.preventDefault()}
        aria-busy={pending || undefined}
        data-tour="board-search"
      >
        <SearchIcon size={18} />
        <label className="lg-sr" htmlFor="company-search">
          Search companies
        </label>
        <input
          ref={input}
          id="company-search"
          type="search"
          value={text}
          maxLength={100}
          placeholder="Search companies"
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => go({ q: value.trim() }), 300);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && isPhone()) {
              e.preventDefault();
              closeSearch();
            }
          }}
          className="lg-input"
        />
        <button type="button" className="lg-bsearch-clear" onClick={closeSearch}>
          <CloseIcon size={16} />
          <span className="lg-sr">Clear the search and close it</span>
        </button>
      </form>
      {showFilter && (
        <div className="lg-bfilter" data-active={industry !== "" || undefined}>
          <LedgerMenu label="Industry" hideLabel value={industry} options={options} onChange={pickIndustry} />
          {industry && (
            <button
              type="button"
              className="lg-fchip"
              onClick={() => {
                setIndustry("");
                go({ industry: "" });
                // The chip goes with the filter: on a phone focus moves to the ⋯ menu that sets it.
                if (isPhone()) focusSoon('[data-tour="board-more"]');
              }}
            >
              <span className="lg-fchip-text" aria-hidden="true">
                {industry}
              </span>
              <CloseIcon size={14} />
              <span className="lg-sr">Clear the industry filter: {industry}</span>
            </button>
          )}
        </div>
      )}
      {renderEnd({ items: industryItems, note: industry ? `industry filter on, ${industry}` : "" })}
      <p role="status" className="lg-sr">
        {pending ? "Loading the board..." : ""}
      </p>
    </>
  );
}
