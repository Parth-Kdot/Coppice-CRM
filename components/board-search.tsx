"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import "@/components/ledger/zod-jitless";
import { CloseIcon, SearchIcon } from "@/components/ledger/icons";
import { LedgerMenu } from "@/components/ledger/ledger-menu";
import { boardQuery, type BoardFilters } from "@/lib/validation";

type Props = {
  filters: BoardFilters;
  industries: string[];
  // The industry filter only shows once there are enough companies for it to help (or one is set).
  showFilter: boolean;
};

// Search box and industry filter. They only change the URL; the server renders the board for it,
// so a filtered board can be bookmarked and Back works. Typing waits 300 ms after the last key so
// each keystroke doesn't load the board.
//
// Both hold their own value, so a pick shows at once while the server catches up, and both follow
// the URL when it changes some other way (the Board tab, Back, Forward): a URL value this box
// pushed itself is not echoed back into it, so typing on while a search loads is never undone.
export function BoardSearch({ filters, industries, showFilter }: Props) {
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

  return (
    <>
      <form className="lg-bsearch" role="search" onSubmit={(e) => e.preventDefault()} aria-busy={pending || undefined} data-tour="board-search">
        <SearchIcon size={18} />
        <label className="lg-sr" htmlFor="company-search">
          Search companies
        </label>
        <input
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
          className="lg-input"
        />
      </form>
      {showFilter && (
        <div className="lg-bfilter">
          <LedgerMenu
            label="Industry"
            hideLabel
            value={industry}
            options={options}
            onChange={(value) => {
              if (value === industry) return;
              setIndustry(value);
              go({ industry: value });
            }}
          />
          {industry && (
            <button
              type="button"
              className="lg-fchip"
              onClick={() => {
                setIndustry("");
                go({ industry: "" });
              }}
            >
              <CloseIcon size={14} />
              <span className="lg-sr">Clear the industry filter</span>
            </button>
          )}
        </div>
      )}
      <p role="status" className="lg-sr">
        {pending ? "Loading the board..." : ""}
      </p>
    </>
  );
}
