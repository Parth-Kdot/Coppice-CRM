"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import "@/components/ledger/zod-jitless";
import { SearchIcon } from "@/components/ledger/icons";
import { boardQuery, type BoardFilters } from "@/lib/validation";

type Props = { filters: BoardFilters; industries: string[] };

// Search box and industry filter. They only change the URL; the server renders the board for it,
// so a filtered board can be bookmarked and Back works. Typing waits 300 ms after the last key
// so each keystroke doesn't load the board.
export function BoardSearch({ filters, industries }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(filters.q);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A new search starts over: any column expanded with "Show all" goes back to 50 cards.
  const go = (changes: Partial<BoardFilters>) =>
    startTransition(() => router.replace(`${pathname}${boardQuery({ ...filters, all: null, ...changes })}`, { scroll: false }));

  return (
    <>
      <form className="lg-bsearch" role="search" onSubmit={(e) => e.preventDefault()}>
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
      <label className="lg-bindustry">
        <span className="lg-sr">Industry</span>
        <select value={filters.industry} onChange={(e) => go({ industry: e.target.value })} className="lg-select">
          <option value="">All industries</option>
          {industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
      </label>
      <div role="status" aria-live="polite" className="lg-btop-status">
        {pending && <p className="lg-muted">Loading...</p>}
      </div>
    </>
  );
}
